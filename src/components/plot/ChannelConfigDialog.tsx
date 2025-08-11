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

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { SignalScaling } from "./Plot";
import { DialogDescription } from "@radix-ui/react-dialog";
import type { Values } from "@/lib/types";
import type { EDFSignal } from "@/lib/edf/edftypes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { resample } from "@/lib/resampling/lttb";
import { percentile } from "@/lib/algorithms/quickselect";

export interface ChannelConfigModalProps {
  open: boolean;
  onClose: () => void;
  signal?: EDFSignal;
  values?: Values;
  scaling?: SignalScaling;
  onScalingChange: (label: string, scaling: SignalScaling) => void;
}

const ChannelConfigDialog: React.FC<ChannelConfigModalProps> = ({
  open,
  onClose,
  signal,
  values,
  scaling,
  onScalingChange,
}) => {
  if (signal === undefined || scaling === undefined) {
    return null;
  }

  const isBipolar = !!scaling.bipolar;

  const handleBipolarToggle = (value: boolean) => {
    const updated: SignalScaling = value
      ? {
          bipolar: true,
          midpoint: 0,
          halfrange: 1,
        }
      : {
          bipolar: false,
          min: signal.physicalMin,
          max: signal.physicalMax,
        };
    onScalingChange(signal.label, updated);
  };

  const updateField = (field: keyof SignalScaling, value: number) => {
    const updated: SignalScaling = { ...scaling, [field]: value };
    onScalingChange(signal.label, updated);
  };

  const formatValueWithUnit = (value: number | string) => {
    return `${value}${signal.physicalDimension ? ` ${signal.physicalDimension}` : ""}`;
  };

  const handleAutoscale = () => {
    if (!values || values.length === 0) {
      return;
    }

    // Reduce the number of values to speed up percentile calculation
    const downsampled = resample(values, 5000);

    // Convert to raw values for percentile calculation
    const downsampledValues = downsampled.map((v) => v.value);

    // Get 1st and 99th percentiles
    const low = percentile(downsampledValues, 0.01);
    const high = percentile(downsampledValues, 0.99);

    // Clamp values to the physical range of the signal
    const clamp = (x: number) =>
      Math.max(signal.physicalMin, Math.min(signal.physicalMax, x));
    const lo = clamp(low);
    const hi = clamp(high);

    // Validate bounds
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
      return;
    }

    // Build the new scaling object
    const updated: SignalScaling = isBipolar
      ? {
          bipolar: true,
          midpoint: (lo + hi) / 2,
          halfrange: 1.1 * ((hi - lo) / 2),
        }
      : {
          bipolar: false,
          min: lo * 0.95,
          max: hi * 1.05,
        };

    // Apply the new scaling to the channel
    onScalingChange(signal.label, updated);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{signal.label}</DialogTitle>
          <DialogDescription>
            Configure settings for {signal.label}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="flex justify-start">
            <Button
              onClick={handleAutoscale}
              variant="outline"
              size="sm"
              disabled={values === undefined || values.length === 0}
            >
              Autoscale
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label htmlFor="bipolar">Bipolar</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Bipolar signals have a positive and negative component.
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              id="bipolar"
              checked={isBipolar}
              onCheckedChange={handleBipolarToggle}
            />
          </div>

          {isBipolar ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="midpoint">Midpoint</Label>
                  <span className="text-sm text-muted-foreground">
                    {formatValueWithUnit(
                      scaling.midpoint?.toFixed(2) ?? "0.00",
                    )}
                  </span>
                </div>
                <Slider
                  id="midpoint"
                  min={signal.physicalMin}
                  max={signal.physicalMax}
                  step={0.01}
                  value={[scaling.midpoint ?? 0]}
                  onValueChange={([val]) => updateField("midpoint", val)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="halfrange">Half-range</Label>
                  <span className="text-sm text-muted-foreground">
                    {formatValueWithUnit(
                      scaling.halfrange?.toFixed(2) ?? "1.00",
                    )}
                  </span>
                </div>
                <Slider
                  id="halfrange"
                  min={0}
                  max={(signal.physicalMax - signal.physicalMin) / 2}
                  step={0.01}
                  value={[scaling.halfrange ?? 1]}
                  onValueChange={([val]) => updateField("halfrange", val)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="min">Min</Label>
                  <span className="text-sm text-muted-foreground">
                    {formatValueWithUnit(
                      scaling.min?.toFixed(2) ?? signal.physicalMin.toFixed(2),
                    )}
                  </span>
                </div>
                <Slider
                  id="min"
                  min={signal.physicalMin + 0.01}
                  max={signal.physicalMax}
                  step={0.01}
                  value={[scaling.min ?? signal.physicalMin]}
                  onValueChange={([val]) => updateField("min", val)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="max">Max</Label>
                  <span className="text-sm text-muted-foreground">
                    {formatValueWithUnit(
                      scaling.max?.toFixed(2) ?? signal.physicalMax.toFixed(2),
                    )}
                  </span>
                </div>
                <Slider
                  id="max"
                  min={signal.physicalMin}
                  max={signal.physicalMax}
                  step={0.01}
                  value={[scaling.max ?? signal.physicalMax]}
                  onValueChange={([val]) => updateField("max", val)}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChannelConfigDialog;
