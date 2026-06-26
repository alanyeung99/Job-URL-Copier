import { UserSettings, normalizeSettingsDoc } from './models/UserSettings.js';

function normalizeKeywordList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeSelectedSheet(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const spreadsheetId = input.spreadsheetId ? String(input.spreadsheetId).trim() : null;
  const sheetId = input.sheetId ?? input.id ?? null;
  const sheetName = input.sheetName ?? input.name ?? null;
  if (sheetId == null || sheetId === '' || !sheetName) {
    return null;
  }

  const id = String(sheetId);
  const name = String(sheetName);
  return {
    spreadsheetId,
    sheetId: id,
    sheetName: name,
    id,
    name
  };
}

function normalizeRegisteredSpreadsheet(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const name = input.name ? String(input.name).trim() : '';
  const spreadsheetId = input.spreadsheetId ? String(input.spreadsheetId).trim() : '';
  if (!name || !spreadsheetId) {
    return null;
  }

  const url = input.url ? String(input.url).trim() : null;
  return {
    name,
    url: url || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetId
  };
}

function normalizeRegisteredSpreadsheetList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const byId = new Map();
  for (const item of values) {
    const normalized = normalizeRegisteredSpreadsheet(item);
    if (normalized) {
      byId.set(normalized.spreadsheetId, normalized);
    }
  }
  return [...byId.values()];
}

async function migrateLegacySpreadsheets(settings) {
  const raw = await UserSettings.collection.findOne({ _id: settings._id });
  if (!raw) {
    return false;
  }

  const legacyId = raw.spreadsheetId ? String(raw.spreadsheetId).trim() : '';
  const legacyName = raw.spreadsheetName ? String(raw.spreadsheetName).trim() : '';
  const hasLegacyFields =
    raw.activeSpreadsheetId != null ||
    raw.spreadsheetName != null ||
    raw.spreadsheetUrl != null ||
    raw.spreadsheetId != null;

  const update = {};
  const unset = {};

  if (legacyId && legacyName) {
    const list = normalizeRegisteredSpreadsheetList(settings.registeredSpreadsheets);
    if (!list.some((entry) => entry.spreadsheetId === legacyId)) {
      list.push(
        normalizeRegisteredSpreadsheet({
          name: legacyName,
          url: raw.spreadsheetUrl,
          spreadsheetId: legacyId
        })
      );
      update.registeredSpreadsheets = list;
    }

    const activeId = raw.activeSpreadsheetId
      ? String(raw.activeSpreadsheetId).trim()
      : legacyId;
    const selected = settings.selectedSheet || raw.selectedSheet;
    if (activeId && selected?.sheetName && !selected?.spreadsheetId) {
      update.selectedSheet = {
        ...selected,
        spreadsheetId: activeId
      };
    }
  }

  if (hasLegacyFields) {
    unset.activeSpreadsheetId = '';
    unset.spreadsheetName = '';
    unset.spreadsheetUrl = '';
    unset.spreadsheetId = '';
  }

  if (!Object.keys(update).length && !Object.keys(unset).length) {
    return false;
  }

  const patch = {};
  if (Object.keys(update).length) {
    patch.$set = update;
  }
  if (Object.keys(unset).length) {
    patch.$unset = unset;
  }

  await UserSettings.collection.updateOne({ _id: settings._id }, patch);
  const refreshed = await UserSettings.findById(settings._id);
  if (refreshed) {
    settings.registeredSpreadsheets = refreshed.registeredSpreadsheets;
    settings.selectedSheet = refreshed.selectedSheet;
    settings.filters = refreshed.filters;
  }
  return true;
}

export async function getOrCreateUserSettings(userId) {
  let settings = await UserSettings.findOne({ userId });
  if (!settings) {
    settings = await UserSettings.create({ userId });
  }
  await migrateLegacySpreadsheets(settings);
  return settings;
}

export async function getUserSettings(userId) {
  const settings = await getOrCreateUserSettings(userId);
  return normalizeSettingsDoc(settings);
}

export function resolveSpreadsheetIdFromSettings(settings, querySpreadsheetId) {
  if (querySpreadsheetId) {
    return String(querySpreadsheetId).trim();
  }
  if (settings?.selectedSheet?.spreadsheetId) {
    return String(settings.selectedSheet.spreadsheetId).trim();
  }
  return settings?.registeredSpreadsheets?.[0]?.spreadsheetId || null;
}

export async function updateUserSettings(userId, payload) {
  const settings = await getOrCreateUserSettings(userId);

  const registrationOnly =
    payload.registeredSpreadsheets !== undefined &&
    payload.selectedSheet === undefined &&
    payload.filters === undefined;

  if (registrationOnly) {
    settings.registeredSpreadsheets = normalizeRegisteredSpreadsheetList(
      payload.registeredSpreadsheets
    );

    const selectedSpreadsheetId = settings.selectedSheet?.spreadsheetId
      ? String(settings.selectedSheet.spreadsheetId).trim()
      : null;
    if (
      selectedSpreadsheetId &&
      !settings.registeredSpreadsheets.some(
        (entry) => entry.spreadsheetId === selectedSpreadsheetId
      )
    ) {
      settings.selectedSheet = null;
    }

    await settings.save();
    return normalizeSettingsDoc(settings);
  }

  if (payload.registeredSpreadsheets !== undefined) {
    settings.registeredSpreadsheets = normalizeRegisteredSpreadsheetList(
      payload.registeredSpreadsheets
    );
  }

  if (payload.selectedSheet !== undefined) {
    settings.selectedSheet = normalizeSelectedSheet(payload.selectedSheet);
  }

  if (payload.filters !== undefined) {
    settings.filters = {
      company: normalizeKeywordList(payload.filters?.company),
      position: normalizeKeywordList(payload.filters?.position)
    };
  }

  await settings.save();
  return normalizeSettingsDoc(settings);
}
