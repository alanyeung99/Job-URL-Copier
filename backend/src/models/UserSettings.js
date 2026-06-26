import mongoose from 'mongoose';

const selectedSheetSchema = new mongoose.Schema(
  {
    spreadsheetId: { type: String, default: null, trim: true },
    sheetId: { type: String, default: null },
    sheetName: { type: String, default: null },
    id: { type: String, default: null },
    name: { type: String, default: null }
  },
  { _id: false }
);

const registeredSpreadsheetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, default: null },
    spreadsheetId: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const filtersSchema = new mongoose.Schema(
  {
    company: { type: [String], default: [] },
    position: { type: [String], default: [] }
  },
  { _id: false }
);

const userSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    registeredSpreadsheets: { type: [registeredSpreadsheetSchema], default: [] },
    selectedSheet: { type: selectedSheetSchema, default: null },
    filters: { type: filtersSchema, default: () => ({ company: [], position: [] }) }
  },
  { timestamps: true }
);

export const UserSettings = mongoose.model('UserSettings', userSettingsSchema);

export function normalizeSettingsDoc(doc) {
  if (!doc) {
    return null;
  }

  const registeredSpreadsheets = Array.isArray(doc.registeredSpreadsheets)
    ? doc.registeredSpreadsheets
        .map((entry) => ({
          name: entry?.name ? String(entry.name).trim() : '',
          url: entry?.url ? String(entry.url).trim() : null,
          spreadsheetId: entry?.spreadsheetId ? String(entry.spreadsheetId).trim() : ''
        }))
        .filter((entry) => entry.name && entry.spreadsheetId)
    : [];

  const selectedSheet = doc.selectedSheet
    ? {
        spreadsheetId: doc.selectedSheet.spreadsheetId
          ? String(doc.selectedSheet.spreadsheetId).trim()
          : null,
        sheetId: doc.selectedSheet.sheetId ?? doc.selectedSheet.id ?? null,
        sheetName: doc.selectedSheet.sheetName ?? doc.selectedSheet.name ?? null,
        id: doc.selectedSheet.id ?? doc.selectedSheet.sheetId ?? null,
        name: doc.selectedSheet.name ?? doc.selectedSheet.sheetName ?? null
      }
    : null;

  return {
    registeredSpreadsheets,
    selectedSheet,
    filters: {
      company: Array.isArray(doc.filters?.company) ? doc.filters.company : [],
      position: Array.isArray(doc.filters?.position) ? doc.filters.position : []
    },
    updatedAt: doc.updatedAt?.toISOString?.() || null
  };
}
