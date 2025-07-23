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

import React from "react";
import { Loader2 } from "lucide-react";

export interface FullPageSpinnerProps {
  message?: string;
}

const FullPageSpinner: React.FC<FullPageSpinnerProps> = ({ message }) => {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex flex-col items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-white select-none" />
      {message && (
        <div className="mt-2 text-sm text-white select-none">{message}</div>
      )}
    </div>
  );
};

export default FullPageSpinner;
