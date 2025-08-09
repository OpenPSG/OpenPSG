/*
 * Copyright (C) 2025 The OpenPSG Authors
 *
 * This file is licensed under the Functional Source License 1.1
 * with a grant of AGPLv3-or-later effective two years after publication.
 *
 * You may not use this file except in compliance with the License.
 * A copy of the license is available in the root of the repository
 * and online at: https://fsl.software
 *
 * After two years from publication, this file may also be used under
 * the GNU Affero General Public License, version 3 or (at your option) any
 * later version. See <https://www.gnu.org/licenses/agpl-3.0.html> for details.
 */

import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import PlotlyPlot from "react-plotly.js";
import "./plot.css";
import { lttb } from "@/lib/resampling/lttb";
import ChannelConfigDialog from "./ChannelConfigDialog";
import { parseRelayoutEvent, getTickValsAndText } from "./utils";
import type { EDFSignal } from "@/lib/edf/edftypes";
import { EPOCH_DURATION_MS } from "@/lib/constants";
import type { Values } from "@/lib/types";
import throttle from "lodash/throttle";

const binarySearch = (arr: number[], target: number): number => {
  let left = 0,
    right = arr.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (arr[mid] <= target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left - 1;
};

// How frequently to respond to x-axis range changes
const XRANGE_UPDATE_INTERVAL = 100; // ms

const useXRange = (startTime?: number, endTime?: number) => {
  // We need two separate state variables for the x-axis range otherwise
  // bidirectional updates can cause issues
  const [xRange, setXRange] = useState<[number, number] | undefined>(undefined);
  const [plotlyXRange, setPlotlyXRange] = useState<[number, number]>([
    0,
    EPOCH_DURATION_MS, // Just a dummy initial value for the recording plot etc.
  ]);

  useEffect(() => {
    if (xRange) {
      setPlotlyXRange(xRange);
    }
  }, [xRange]);

  const throttledSetXRange = useMemo(() => {
    const throttled = throttle(
      (start: number, end: number, noclamp: boolean) => {
        if (startTime === undefined || endTime === undefined) return;

        let newStart = start;
        if (!noclamp) {
          newStart = Math.max(startTime, start);
        }
        let newEnd = end;
        if (!noclamp) {
          newEnd = Math.min(endTime, end);
        }
        if (newEnd - newStart < 1) {
          newEnd = newStart + 1;
        }

        setXRange([newStart, newEnd]);
      },
      XRANGE_UPDATE_INTERVAL,
    );
    return throttled;
  }, [startTime, endTime]);

  return { xRange, plotlyXRange, throttledSetXRange };
};

const useKeyboardNavigation = (
  ref: React.RefObject<HTMLDivElement | null>,
  xRange: [number, number] | undefined,
  setXRange: (start: number, end: number, noclamp: boolean) => void,
  startTime?: number,
  endTime?: number,
  followMode?: boolean,
) => {
  useEffect(() => {
    if (followMode || !ref.current) return;
    const el = ref.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!xRange) return;

      const [start, end] = xRange;
      const windowSize = end - start;
      const moveBy = windowSize * 0.1;

      if (e.key === "ArrowRight") {
        if (endTime !== undefined && end >= endTime) return;
        setXRange(start + moveBy, end + moveBy, false);
      } else if (e.key === "ArrowLeft") {
        if (startTime !== undefined && start <= startTime) return;
        setXRange(start - moveBy, end - moveBy, false);
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [xRange, setXRange, startTime, endTime, followMode, ref]);
};

export interface SignalScaling {
  bipolar?: boolean;
  midpoint?: number;
  halfrange?: number;
  min?: number;
  max?: number;
}

export interface PlotProps {
  signals: EDFSignal[];
  values: Values[];
  followMode?: boolean;
  revision?: number;
}

const Plot: React.FC<PlotProps> = ({
  signals,
  values,
  followMode,
  revision = 0,
}) => {
  const plotWrapperRef = useRef<HTMLDivElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (followMode) return;
    if (plotWrapperRef.current) {
      if (modalOpen) {
        plotWrapperRef.current.blur();
      } else {
        plotWrapperRef.current.focus();
      }
    }
  }, [modalOpen, followMode]);

  const { startTime, endTime } = useMemo(() => {
    void revision;

    if (!signals || signals.length === 0) {
      return {};
    }
    if (values.length === 0) {
      return {};
    }

    let minStart = Infinity;
    let maxEnd = 0;

    for (const series of values) {
      if (!series || series.timestamps.length === 0) continue;

      const first = series.timestamps[0];
      const last = series.timestamps[series.timestamps.length - 1];

      if (first < minStart) minStart = first;
      if (last > maxEnd) maxEnd = last;
    }

    if (minStart === Infinity) {
      return {};
    }

    return { startTime: minStart, endTime: maxEnd };
  }, [signals, values, revision]);

  const { xRange, plotlyXRange, throttledSetXRange } = useXRange(
    startTime,
    endTime,
  );

  useEffect(() => {
    if (!followMode || endTime === undefined) return;

    const end = xRange !== undefined ? xRange[1] : 0;
    if (endTime > end) {
      const alignedEnd =
        Math.ceil(endTime / EPOCH_DURATION_MS) * EPOCH_DURATION_MS;
      const alignedStart = alignedEnd - EPOCH_DURATION_MS;
      throttledSetXRange(alignedStart, alignedEnd, true);
    }
  }, [endTime, followMode, xRange, throttledSetXRange]);

  useKeyboardNavigation(
    plotWrapperRef,
    xRange,
    throttledSetXRange,
    startTime,
    endTime,
    followMode,
  );

  const { tickvals, ticktext } = useMemo(() => {
    if (!xRange) return { tickvals: [], ticktext: [] };

    const [start, end] = xRange;
    return getTickValsAndText(start, end);
  }, [xRange]);

  const [channelScaling, setChannelScaling] = useState<
    Map<string, SignalScaling>
  >(new Map());

  useEffect(() => {
    signals.forEach((signal) => {
      setChannelScaling((prev) => {
        const next = new Map(prev);
        if (!next.has(signal.label)) {
          next.set(signal.label, {
            bipolar: true,
            midpoint:
              ((signal.physicalMin ?? -1) + (signal.physicalMax ?? 1)) / 2,
            halfrange:
              ((signal.physicalMax ?? 1) - (signal.physicalMin ?? -1)) / 2,
          });
        }
        return next;
      });
    });
  }, [signals]);

  const yAxisRanges = useMemo(() => {
    return signals.map((signal) => {
      const scaling = channelScaling.get(signal.label);

      if (
        scaling?.bipolar &&
        scaling.midpoint != null &&
        scaling.halfrange != null
      ) {
        return [
          scaling.midpoint - scaling.halfrange,
          scaling.midpoint + scaling.halfrange,
        ];
      } else if (scaling?.min != null && scaling.max != null) {
        return [scaling.min, scaling.max];
      } else {
        return undefined;
      }
    });
  }, [signals, channelScaling]);

  const traces = useMemo(() => {
    void revision;

    return signals.map((signal, index) => {
      const series = values[index];
      if (!series || series.timestamps.length === 0) {
        return {
          x: [],
          y: [],
          type: "scattergl" as const,
          mode: "lines" as const,
          name: signal.label,
          yaxis: `y${index === 0 ? "" : index + 1}` as Plotly.AxisName,
          line: { width: 1 },
          hovertemplate: `<b>${signal.label}</b><br>Value: %{y:.2f} ${signal.physicalDimension}<extra></extra>`,
        };
      }

      let lowerIndex = 0;
      let upperIndex = series.timestamps.length - 1;

      if (xRange) {
        const lowerIndexRaw = binarySearch(series.timestamps, xRange[0]);
        lowerIndex = Math.max(0, lowerIndexRaw + 1);

        const upperIndexRaw = binarySearch(series.timestamps, xRange[1]);
        upperIndex = Math.min(
          series.timestamps.length - 1,
          Math.max(upperIndexRaw, 0),
        );
      }

      const seriesRange: Values = {
        timestamps: series.timestamps.slice(lowerIndex, upperIndex + 1),
        values: series.values.slice(lowerIndex, upperIndex + 1),
      };

      const { timestamps: x, values: y } = lttb(seriesRange, 4000);

      return {
        x,
        y,
        type: "scattergl" as const,
        mode: "lines" as const,
        name: signal.label,
        yaxis: `y${index === 0 ? "" : index + 1}` as Plotly.AxisName,
        line: { width: 1 },
        hovertemplate: `<b>${signal.label}</b><br>Value: %{y:.2f} ${signal.physicalDimension}<extra></extra>`,
      };
    });
  }, [signals, values, xRange, revision]);

  const layout: Partial<Plotly.Layout> | undefined = useMemo(() => {
    if (signals.length !== yAxisRanges.length) return undefined;
    if (yAxisRanges.some((range) => range === undefined)) return undefined;

    return {
      showlegend: false,
      plot_bgcolor: "rgba(255, 255, 204, 0.1)",
      paper_bgcolor: "white",
      grid: {
        rows: signals.length,
        columns: 1,
        pattern: "independent" as const,
      },
      margin: { t: 30, l: 0, r: 0, b: 30 },
      xaxis: {
        domain: [0, 1],
        anchor:
          `y${signals.length === 1 ? "" : signals.length}` as Plotly.AxisName,
        showgrid: true,
        gridcolor: "#ddd",
        side: "bottom" as const,
        range: plotlyXRange,
        constrain: "range" as const,
        tickvals,
        ticktext,
        tickangle: 0,
        tickfont: { size: 10 },
        fixedrange: followMode,
      },
      ...Object.fromEntries(
        signals.map((_, i) => [
          `yaxis${i === 0 ? "" : i + 1}`,
          {
            domain: [1 - (i + 1) / signals.length, 1 - i / signals.length],
            showticklabels: false,
            fixedrange: true,
            zeroline: false,
            showgrid: false,
            ticks: "",
            range: yAxisRanges[i],
          },
        ]),
      ),
      updatemenus: signals.map((signal, i) => {
        const domainStart = 1 - (i + 1) / signals.length;
        const domainCenter = domainStart + 1 / (2 * signals.length);
        return {
          type: "buttons",
          direction: "right",
          showactive: false,
          x: 0,
          y: domainCenter,
          xanchor: "left",
          yanchor: "middle",
          pad: { r: 0, t: 0 },
          buttons: [
            {
              label: `${signal.label} (${signal.physicalDimension})`,
              method: "relayout",
              args: [{ label: signal.label } as ButtonClickEvent],
              execute: true,
            },
          ],
          font: {
            size: 10,
          },
          bgcolor: "rgba(255, 255, 255, 0.7)",
        };
      }),
    };
  }, [plotlyXRange, tickvals, ticktext, signals, yAxisRanges, followMode]);

  const handleRelayout = useCallback(
    (e: Partial<Plotly.Layout>) => {
      const range = parseRelayoutEvent(e, startTime);
      if (range) {
        throttledSetXRange(range[0], range[1], false);
      }
    },
    [throttledSetXRange, startTime],
  );

  const [selectedChannel, setSelectedChannel] = useState<number | undefined>(
    undefined,
  );

  interface ButtonClickEvent {
    label: string;
  }

  const handleClickButton = useCallback(
    (event: ButtonClickEvent) => {
      const label = event.label;
      const index = signals.findIndex((s) => s.label === label);
      if (index !== -1) {
        setSelectedChannel(index);
        setModalOpen(true);
      }
    },
    [signals],
  );

  return (
    <div
      ref={plotWrapperRef}
      tabIndex={0}
      className="w-full h-full px-2 outline-none"
    >
      <ChannelConfigDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        signal={
          selectedChannel !== undefined && signals.length > selectedChannel
            ? signals[selectedChannel]
            : undefined
        }
        values={
          selectedChannel !== undefined && values.length > selectedChannel
            ? values[selectedChannel]
            : undefined
        }
        scaling={
          selectedChannel !== undefined && signals.length > selectedChannel
            ? channelScaling.get(signals[selectedChannel].label)
            : undefined
        }
        onScalingChange={(label, newScaling) => {
          setChannelScaling((prev) => {
            const next = new Map(prev);
            next.set(label, newScaling);
            return next;
          });
        }}
      />

      {layout && (
        <PlotlyPlot
          className="w-full h-full"
          data={traces}
          layout={layout}
          onRelayout={(event) => {
            if ("label" in event) {
              handleClickButton(event as ButtonClickEvent);
            } else {
              handleRelayout(event as Partial<Plotly.Layout>);
            }
          }}
          config={{
            responsive: true,
            scrollZoom: !followMode,
          }}
          useResizeHandler
        />
      )}
    </div>
  );
};

export default Plot;
