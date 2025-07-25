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
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Info } from "lucide-react";
import { useForm } from "react-hook-form";
import type { Driver, ConfigValue, ConfigField } from "@/lib/drivers/driver";
import { useEffect } from "react";

const isFieldVisible = (
  field: ConfigField,
  values: Record<string, ConfigValue>,
): boolean => {
  if (!field.visibleIf) return true;

  return field.visibleIf.some((group) => {
    const operator = group.operator ?? "AND";
    const results = group.conditions.map(
      (cond) => values[cond.field] === cond.value,
    );
    return operator === "AND" ? results.every(Boolean) : results.some(Boolean);
  });
};

interface SensorConfigDialogProps {
  open: boolean;
  activeDriver?: Driver;
  onComplete: (submitted: boolean, data?: Record<string, ConfigValue>) => void;
}

const SensorConfigDialog: React.FC<SensorConfigDialogProps> = ({
  open,
  activeDriver,
  onComplete,
}) => {
  const { register, handleSubmit, reset, formState, setValue, watch } =
    useForm();

  const formValues = watch();

  // Initialize default values on driver change
  useEffect(() => {
    if (!activeDriver?.configSchema) return;

    const defaults: Record<string, ConfigValue> = {};
    activeDriver.configSchema.forEach((field) => {
      if (field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      } else if (field.type === "boolean") {
        defaults[field.name] = false;
      }
    });

    reset(defaults);
  }, [activeDriver?.configSchema, reset]);

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onComplete(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Sensor</DialogTitle>
          <DialogDescription>
            Set configuration options for this sensor.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((data: Record<string, ConfigValue>) => {
            onComplete(true, data);
          })}
          className="space-y-4"
        >
          {activeDriver?.configSchema?.map((field) => {
            if (!isFieldVisible(field, formValues)) return null;

            return (
              <div key={field.name} className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  {field.description && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        {field.description}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {field.type === "select" ? (
                  <Select
                    defaultValue={
                      field.defaultValue != null
                        ? String(field.defaultValue)
                        : undefined
                    }
                    onValueChange={(val) => setValue(field.name, val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${field.label}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "boolean" ? (
                  <div className="flex items-center space-x-2">
                    <Switch
                      id={field.name}
                      checked={Boolean(formValues[field.name])}
                      onCheckedChange={(val) => setValue(field.name, val)}
                    />
                  </div>
                ) : (
                  <Input
                    id={field.name}
                    type={field.type}
                    defaultValue={
                      field.defaultValue == null
                        ? undefined
                        : String(field.defaultValue)
                    }
                    {...register(field.name, {
                      required: field.required && `${field.label} is required`,
                      maxLength: field.maxLength && {
                        value: field.maxLength,
                        message: `${field.label} must be at most ${field.maxLength} characters`,
                      },
                      minLength: field.minLength && {
                        value: field.minLength,
                        message: `${field.label} must be at least ${field.minLength} characters`,
                      },
                    })}
                  />
                )}

                {formState.errors[field.name] && (
                  <p className="text-sm text-red-500">
                    {formState.errors[field.name]?.message as string}
                  </p>
                )}
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button type="submit">Save Configuration</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SensorConfigDialog;
