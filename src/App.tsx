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
  Routes,
  Route,
  useNavigate,
  useLocation,
  Navigate,
} from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Videotape, Info, Monitor } from "lucide-react";
import About from "@/components/About";
import Record from "@/components/record/Record";
import View from "@/components/View";

const TABS = [
  {
    path: "/record",
    label: "Record",
    icon: <Videotape className="w-4 h-4" />,
  },
  {
    path: "/view",
    label: "View",
    icon: <Monitor className="w-4 h-4" />,
  },
  {
    path: "/about",
    label: "About",
    icon: <Info className="w-4 h-4" />,
  },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // Extract the current tab from the pathname
  const activeTab =
    TABS.find((tab) => location.pathname.startsWith(tab.path))?.path ||
    "/record";

  const handleTabChange = (newPath: string) => {
    navigate(newPath);
  };

  return (
    <main className="h-screen flex flex-col bg-gray-50">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex flex-col h-full"
      >
        <div className="border-b bg-white shadow-sm p-2">
          <TabsList className="flex justify-center items-center space-x-4 w-full max-w-4xl mx-auto">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.path}
                value={tab.path}
                className="flex items-center gap-2"
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex items-center justify-center w-full h-full overflow-y-auto">
          <Routes>
            <Route
              path="/record/*"
              element={
                <TabsContent
                  value="/record"
                  className="flex items-center justify-center w-full h-full"
                >
                  <Record />
                </TabsContent>
              }
            />
            <Route
              path="/view"
              element={
                <TabsContent
                  value="/view"
                  className="flex items-center justify-center w-full h-full"
                >
                  <View />
                </TabsContent>
              }
            />
            <Route
              path="/about"
              element={
                <TabsContent
                  value="/about"
                  className="flex items-center justify-center w-full h-full"
                >
                  <About />
                </TabsContent>
              }
            />
            {/* Default redirect */}
            <Route path="*" element={<Navigate to="/record" replace />} />
          </Routes>
        </div>
      </Tabs>
    </main>
  );
}
