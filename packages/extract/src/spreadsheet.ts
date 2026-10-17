/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Seam for spreadsheet (XLSX) input. A real .xlsx is a zip of XML — that
 * work is deliberately left to the caller's library of choice (SheetJS,
 * exceljs, ...) so this package stays zero-dependency. Implement this
 * interface with your library and pass it as `options.spreadsheet`.
 *
 * Example (SheetJS):
 *
 *   import * as XLSX from 'xlsx';
 *   const spreadsheet: SpreadsheetProvider = {
 *     name: 'sheetjs',
 *     readSheet(data) {
 *       const wb = XLSX.read(data, { type: 'array' });
 *       const ws = wb.Sheets[wb.SheetNames[0]];
 *       return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
 *     },
 *   };
 */
export interface SpreadsheetProvider {
  readonly name: string;
  /**
   * Returns the first worksheet as rows of display-formatted cell
   * strings (dates/amounts rendered the way the bank shows them).
   */
  readSheet(data: Uint8Array): readonly (readonly string[])[];
}
