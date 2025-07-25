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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, Book } from "lucide-react";

const buildVersion = import.meta.env.VITE_BUILD_VERSION;

export default function About() {
  return (
    <Card className="max-w-lg w-full mx-auto shadow-xl">
      <CardHeader className="flex items-center gap-2">
        <Info className="w-6 h-6" />
        <CardTitle className="text-xl">About</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-left text-gray-400">
          <p className="mb-2">
            OpenPSG is not a medical device and is not intended to diagnose,
            monitor, treat, or prevent any disease or medical condition. It is
            designed for research and general informational purposes only. The
            data provided should not be used as a basis for medical decisions or
            relied upon for health assessment or treatment. OpenPSG does not
            offer medical advice and should not be considered a substitute for
            professional healthcare.
          </p>
          <p className="mb-2">
            Users are responsible for ensuring that their use of this tool
            complies with all applicable laws, regulations, and standards in
            their region.
          </p>
        </div>
        <div className="text-center mt-4 text-gray-400 text-xs">
          Version: {buildVersion}
        </div>
        <div className="text-center mt-4">
          <a
            href="https://docs.openpsg.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium text-sm"
          >
            <Book className="w-4 h-4" />
            OpenPSG Documentation
          </a>
        </div>
        <div className="text-center mt-2 space-x-4">
          <a
            href="/privacy.html"
            className="text-blue-500 hover:underline text-xs"
          >
            Privacy Policy
          </a>
          <a
            href="/impressum.html"
            className="text-blue-500 hover:underline text-xs"
          >
            Impressum
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
