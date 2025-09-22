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
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bluetooth, Mic } from "lucide-react";

export type SensorType = "ble" | "snore";

interface SensorTypeDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (type: SensorType) => void;
  isConnecting?: boolean;
}

const SensorTypeDialog: React.FC<SensorTypeDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  isConnecting = false,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Sensor</DialogTitle>
          <DialogDescription>
            What type of sensor would you like to add?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-24 flex flex-col items-center justify-center gap-2"
            onClick={() => onSelect("ble")}
            disabled={isConnecting}
            aria-label="Add Wireless (BLE) sensor"
          >
            <Bluetooth className="w-7 h-7" />
            <span className="text-sm font-medium">Wireless (BLE)</span>
          </Button>

          <Button
            variant="outline"
            className="h-24 flex flex-col items-center justify-center gap-2"
            onClick={() => onSelect("snore")}
            disabled={isConnecting}
            aria-label="Add Snore sensor"
          >
            <Mic className="w-7 h-7" />
            <span className="text-sm font-medium">Snore</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SensorTypeDialog;
