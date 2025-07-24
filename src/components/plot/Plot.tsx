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
import { resample } from "@/lib/resampling/resample";
import ChannelConfigDialog from "./ChannelConfigDialog";
import { parseRelayoutEvent, getTickValsAndText } from "./utils";
import type { EDFSignal } from "@/lib/edf/edftypes";
import { EPOCH_DURATION } from "@/lib/constants";
import type { Values } from "@/lib/types";
import throttle from "lodash/throttle";

// How frequently to respond to x-axis range changes
const XRANGE_UPDATE_INTERVAL = 100; // ms

const useXRange = (totalDuration: number) => {
  // We need two separate state variables for the x-axis range otherwise
  // bidirectional updates can cause issues
  const [xRange, setXRange] = useState<[number, number]>([0, EPOCH_DURATION]);
  const [plotlyXRange, setPlotlyXRange] = useState<[number, number]>([
    0,
    EPOCH_DURATION,
  ]);

  useEffect(() => {
    setPlotlyXRange(xRange);
  }, [xRange]);

  const throttledSetXRange = useMemo(() => {
    const throttled = throttle(
      (start: number, end: number, noclamp: boolean) => {
        const newStart = Math.max(0, start);
        let newEnd = end;
        if (!noclamp) {
          newEnd = Math.min(totalDuration, end);
        }
        if (newEnd - newStart < 1) {
          newEnd = newStart + 1;
        }

        setXRange([newStart, newEnd]);
      },
      XRANGE_UPDATE_INTERVAL,
    );
    return throttled;
  }, [totalDuration]);

  return { xRange, plotlyXRange, throttledSetXRange };
};

const useKeyboardNavigation = (
  ref: React.RefObject<HTMLDivElement | null>,
  xRange: [number, number],
  totalDuration: number,
  setXRange: (start: number, end: number, noclamp: boolean) => void,
  followMode?: boolean,
) => {
  useEffect(() => {
    if (followMode || !ref.current) return;
    const el = ref.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      const [start, end] = xRange;
      const windowSize = end - start;
      const moveBy = windowSize * 0.1;

      if (e.key === "ArrowRight") {
        if (end >= totalDuration) return;
        setXRange(start + moveBy, end + moveBy, false);
      } else if (e.key === "ArrowLeft") {
        if (start <= 0) return;
        setXRange(start - moveBy, end - moveBy, false);
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [xRange, totalDuration, setXRange, followMode, ref]);
};

export interface SignalScaling {
  bipolar?: boolean;
  midpoint?: number;
  halfrange?: number;
  min?: number;
  max?: number;
}

export interface PlotProps {
  startTime: Date;
  signals: EDFSignal[];
  values: Values[];
  followMode?: boolean;
  revision?: number;
}

const Plot: React.FC<PlotProps> = ({
  startTime,
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

  const totalDuration = useMemo(() => {
    void revision;

    if (!signals || signals.length === 0) return 0;
    if (values.length === 0) return 0;

    const maxDuration = values.reduce((max, series) => {
      if (series.timestamps.length === 0) return max;
      const lastTimestamp = series.timestamps[series.timestamps.length - 1];
      return Math.max(max, lastTimestamp - startTime.getTime());
    }, 0);
    return Math.max(maxDuration, EPOCH_DURATION) / 1000;
  }, [signals, startTime, values, revision]);

  const { xRange, plotlyXRange, throttledSetXRange } = useXRange(totalDuration);

  useEffect(() => {
    if (!followMode) return;
    const end = xRange[1];
    if (totalDuration > end) {
      const nextStart =
        Math.floor(totalDuration / EPOCH_DURATION) * EPOCH_DURATION;
      const nextEnd = nextStart + EPOCH_DURATION;
      throttledSetXRange(nextStart, nextEnd, true);
    }
  }, [totalDuration, followMode, xRange, throttledSetXRange]);

  useKeyboardNavigation(
    plotWrapperRef,
    xRange,
    totalDuration,
    throttledSetXRange,
    followMode,
  );

  const { tickvals, ticktext } = useMemo(() => {
    const [start, end] = xRange;
    return getTickValsAndText(start, end, startTime);
  }, [xRange, startTime]);

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

      const startTimeMs = startTime.getTime();
      const timeSeconds = series.timestamps.map(
        (t) => (t - startTimeMs) / 1000,
      );

      const safeStart = Math.max(xRange[0], timeSeconds[0]);
      const safeEnd = Math.min(xRange[1], timeSeconds[timeSeconds.length - 1]);

      const xFiltered: number[] = [];
      const yFiltered: number[] = [];

      for (let i = 0; i < timeSeconds.length; i++) {
        const t = timeSeconds[i];
        if (t >= safeStart && t <= safeEnd) {
          xFiltered.push(t);
          yFiltered.push(series.values[i]);
        }
      }

      let x: number[] = xFiltered;
      let y: number[] = yFiltered;

      if (xFiltered.length > 4000) {
        const slicedValues: Values = {
          timestamps: xFiltered.map((t) => t * 1000 + startTimeMs),
          values: yFiltered,
        };
        const resampled = resample(slicedValues, 4000);
        x = resampled.timestamps.map((ts) => (ts - startTimeMs) / 1000);
        y = resampled.values;
      }

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
  }, [signals, values, xRange, startTime, revision]);

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
        };
      }),
    };
  }, [plotlyXRange, tickvals, ticktext, signals, yAxisRanges, followMode]);

  const handleRelayout = useCallback(
    (e: Partial<Plotly.Layout>) => {
      const range = parseRelayoutEvent(e, totalDuration);
      if (range) {
        throttledSetXRange(range[0], range[1], true);
      }
    },
    [throttledSetXRange, totalDuration],
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
