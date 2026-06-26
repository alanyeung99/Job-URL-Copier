import { useEffect, useState } from 'react';
import {
  clearSession,
  createWebSession,
  ensureGoogleAccessToken,
  fetchAuthConfig,
  fetchSettings,
  fetchSheetPreview,
  fetchSheetTabs,
  requestGoogleAccessTokenInteractive,
  restoreSession,
  saveSession,
  saveSettings,
  parseSpreadsheetId,
  normalizeSpreadsheetUrl
} from './api.js';

function emptyFilters() {
  return { company: [], position: [] };
}

function upsertRegisteredSpreadsheet(list, entry) {
  const next = Array.isArray(list) ? [...list] : [];
  const index = next.findIndex((item) => item.spreadsheetId === entry.spreadsheetId);
  if (index >= 0) {
    next[index] = entry;
  } else {
    next.push(entry);
  }
  return next;
}

function settingsPayload(settings, overrides = {}) {
  return {
    registeredSpreadsheets: settings?.registeredSpreadsheets || [],
    selectedSheet: settings?.selectedSheet || null,
    filters: settings?.filters || emptyFilters(),
    ...overrides
  };
}

function resolvePreviewSpreadsheetId(settings) {
  return (
    settings?.selectedSheet?.spreadsheetId ||
    settings?.registeredSpreadsheets?.[0]?.spreadsheetId ||
    null
  );
}

const NAV_ITEMS = [
  { id: 'spreadsheets', label: 'Spreadsheets' },
  { id: 'filters', label: 'Filters' },
  { id: 'preview', label: 'Preview' }
];

export default function App() {
  const [authConfig, setAuthConfig] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [settings, setSettings] = useState(null);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');
  const [showAddSpreadsheetForm, setShowAddSpreadsheetForm] = useState(false);
  const [sheetTabs, setSheetTabs] = useState([]);
  const [preview, setPreview] = useState(null);
  const [companyInput, setCompanyInput] = useState('');
  const [positionInput, setPositionInput] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeView, setActiveView] = useState('spreadsheets');

  useEffect(() => {
    fetchAuthConfig()
      .then((data) => setAuthConfig(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authConfig) {
      return;
    }
    setSessionRestoring(true);
    restoreSession(authConfig)
      .then((restored) => {
        if (restored) {
          setSession(restored);
          if (restored.settings) {
            setSettings(restored.settings);
          }
        }
      })
      .catch(() => {
        clearSession();
        setSession(null);
      })
      .finally(() => setSessionRestoring(false));
  }, [authConfig?.googleClientId]);

  useEffect(() => {
    if (!session?.platformToken || sessionRestoring) {
      return;
    }
    void refreshDashboard(session);
  }, [session?.platformToken, sessionRestoring]);

  async function refreshDashboard(activeSession) {
    setError('');
    try {
      let workingSession = activeSession;
      if (!workingSession.googleAccessToken && authConfig) {
        try {
          workingSession = await ensureGoogleAccessToken(workingSession, authConfig);
          setSession(workingSession);
        } catch (_error) {
          // Spreadsheet list still works without Google; preview needs reconnect.
        }
      }

      const data = await fetchSettings(
        workingSession.platformToken,
        workingSession.googleAccessToken
      );
      const nextSettings = data.settings || {};
      setSettings(nextSettings);

      if (!workingSession.googleAccessToken) {
        setSheetTabs([]);
        setPreview(null);
        return;
      }

      const spreadsheetId = resolvePreviewSpreadsheetId(nextSettings);
      if (spreadsheetId) {
        const tabsData = await fetchSheetTabs(
          workingSession.platformToken,
          workingSession.googleAccessToken,
          spreadsheetId
        );
        setSheetTabs(tabsData.sheets || []);

        const sheetName =
          nextSettings.selectedSheet?.sheetName || nextSettings.selectedSheet?.name;
        if (sheetName) {
          const previewData = await fetchSheetPreview(
            workingSession.platformToken,
            workingSession.googleAccessToken,
            sheetName,
            spreadsheetId
          );
          setPreview(previewData.preview || null);
        } else {
          setPreview(null);
        }
      } else {
        setSheetTabs([]);
        setPreview(null);
      }
    } catch (err) {
      if (/target sheet tab/i.test(err?.message || '')) {
        setPreview(null);
        return;
      }
      if (/google access token|sign in with google/i.test(err?.message || '') && authConfig) {
        try {
          const workingSession = await ensureGoogleAccessToken(activeSession, authConfig);
          setSession(workingSession);
          await refreshDashboard(workingSession);
          return;
        } catch (_refreshError) {
          setError('Google access expired. Click Sign in with Google to reconnect Sheets access.');
          return;
        }
      }
      setError(err.message);
    }
  }

  async function handleSignIn() {
    setError('');
    setStatus('Signing in…');
    try {
      const tokenResult = await requestGoogleAccessTokenInteractive(
        authConfig.googleClientId,
        authConfig.scopes
      );
      const data = await createWebSession(tokenResult.accessToken);
      const nextSession = {
        platformToken: data.token,
        googleAccessToken: tokenResult.accessToken,
        googleAccessTokenExpiresAt: tokenResult.expiresAt,
        user: data.user
      };
      saveSession(nextSession);
      setSession(nextSession);
      setSettings(data.settings || null);
      setStatus('Signed in.');
      await refreshDashboard(nextSession);
    } catch (err) {
      const message = err?.message || 'Google sign-in failed.';
      if (/origin|invalid_client|401/i.test(message)) {
        setError(
          `${message} Add ${window.location.origin} under Authorized JavaScript origins for OAuth client ${authConfig?.googleClientId || ''} in Google Cloud Console, then wait 1–2 minutes and try again.`
        );
      } else {
        setError(message);
      }
      setStatus('');
    }
  }

  const loginOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

  function handleSignOut() {
    clearSession();
    setSession(null);
    setSettings(null);
    setNewSheetName('');
    setNewSheetUrl('');
    setShowAddSpreadsheetForm(false);
    setSheetTabs([]);
    setPreview(null);
    setStatus('');
    setError('');
    setActiveView('spreadsheets');
  }

  async function handleAddSpreadsheet() {
    if (!session) {
      return;
    }

    const name = newSheetName.trim();
    if (!name) {
      setError('Enter a name to identify this spreadsheet.');
      return;
    }

    const spreadsheetId = parseSpreadsheetId(newSheetUrl);
    if (!spreadsheetId) {
      setError('Paste a valid Google Sheets link.');
      return;
    }

    setSaving(true);
    setError('');
    setStatus('Saving…');
    try {
      const entry = {
        name,
        url: normalizeSpreadsheetUrl(newSheetUrl) || newSheetUrl.trim(),
        spreadsheetId
      };
      const registeredSpreadsheets = upsertRegisteredSpreadsheet(
        settings?.registeredSpreadsheets,
        entry
      );
      const data = await saveSettings(session.platformToken, session.googleAccessToken, {
        registeredSpreadsheets
      });
      setSettings(data.settings);
      setNewSheetName('');
      setNewSheetUrl('');
      setShowAddSpreadsheetForm(false);
      setStatus('Spreadsheet registered.');
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveSpreadsheet(spreadsheetId) {
    if (!session || !settings) {
      return;
    }

    const registeredSpreadsheets = (settings.registeredSpreadsheets || []).filter(
      (item) => item.spreadsheetId !== spreadsheetId
    );

    setSaving(true);
    setError('');
    try {
      const data = await saveSettings(session.platformToken, session.googleAccessToken, {
        registeredSpreadsheets
      });
      setSettings(data.settings);
      setStatus('Spreadsheet removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTabChange(sheetId) {
    if (!session || !settings) {
      return;
    }

    const match = sheetTabs.find((tab) => String(tab.id) === String(sheetId));
    if (!match) {
      return;
    }

    const selectedSheet = {
      spreadsheetId: resolvePreviewSpreadsheetId(settings),
      sheetId: String(match.sheetId ?? match.id),
      sheetName: String(match.sheetName ?? match.name),
      id: String(match.id ?? match.sheetId),
      name: String(match.name ?? match.sheetName)
    };

    setSaving(true);
    setError('');
    try {
      const data = await saveSettings(session.platformToken, session.googleAccessToken, {
        ...settingsPayload(settings),
        selectedSheet
      });
      setSettings(data.settings);
      const previewData = await fetchSheetPreview(
        session.platformToken,
        session.googleAccessToken,
        selectedSheet.sheetName,
        selectedSheet.spreadsheetId
      );
      setPreview(previewData.preview || null);
      setStatus('Target tab updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addFilter(group) {
    if (!session || !settings) {
      return;
    }

    const raw = group === 'company' ? companyInput : positionInput;
    const keyword = raw.trim();
    if (!keyword) {
      return;
    }

    const filters = {
      company: [...(settings.filters?.company || [])],
      position: [...(settings.filters?.position || [])]
    };

    if (filters[group].some((item) => item.toLowerCase() === keyword.toLowerCase())) {
      return;
    }

    filters[group].push(keyword);
    if (group === 'company') {
      setCompanyInput('');
    } else {
      setPositionInput('');
    }

    setSaving(true);
    setError('');
    try {
      const data = await saveSettings(session.platformToken, session.googleAccessToken, {
        ...settingsPayload(settings),
        filters
      });
      setSettings(data.settings);
      setStatus('Filters updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeFilter(group, keyword) {
    if (!session || !settings) {
      return;
    }

    const filters = {
      company: [...(settings.filters?.company || [])],
      position: [...(settings.filters?.position || [])]
    };
    filters[group] = filters[group].filter((item) => item !== keyword);

    setSaving(true);
    setError('');
    try {
      const data = await saveSettings(session.platformToken, session.googleAccessToken, {
        ...settingsPayload(settings),
        filters
      });
      setSettings(data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || sessionRestoring) {
    return (
      <div className="page">
        <p className="muted">{loading ? 'Loading dashboard…' : 'Restoring your session…'}</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page login-page">
        <div className="card login-card">
          <h1>Job Info Copier</h1>
          <p className="subhead">Manage your spreadsheets, filters, and registered jobs.</p>
          {error ? <p className="alert alert-error">{error}</p> : null}
          <button type="button" className="btn btn-primary" onClick={handleSignIn}>
            Sign in with Google
          </button>
          <p className="hint">
            Use the same Google account as the Chrome extension.
          </p>
          <div className="setup-steps">
            <p className="hint setup-steps-title">If Google shows &quot;no registered origin&quot;:</p>
            <ol className="hint">
              <li>
                Open{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                  Google Cloud → Credentials
                </a>
              </li>
              <li>
                Edit OAuth client{' '}
                <code>{authConfig?.googleClientId || 'Web application'}</code>
              </li>
              <li>
                Under <strong>Authorized JavaScript origins</strong>, add:
                <br />
                <code>{loginOrigin}</code>
              </li>
              <li>Save, wait 1–2 minutes, then click Sign in again</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  const selectedTabId =
    settings?.selectedSheet?.sheetId || settings?.selectedSheet?.id || '';

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Job Info Copier</h1>
          <p className="subhead">Signed in as {session.user?.email}</p>
        </div>
        <button type="button" className="btn btn-link" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <nav className="navbar" aria-label="Dashboard sections">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`navbar-link${activeView === item.id ? ' navbar-link-active' : ''}`}
            onClick={() => setActiveView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? <p className="alert alert-error">{error}</p> : null}
      {status ? <p className="alert alert-ok">{status}</p> : null}

      {activeView === 'spreadsheets' ? (
        <section className="card">
          <div className="section-header">
            <h2>Spreadsheets</h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError('');
                setShowAddSpreadsheetForm((open) => !open);
              }}
              disabled={saving}
            >
              {showAddSpreadsheetForm ? 'Cancel' : 'Add'}
            </button>
          </div>

          {(settings?.registeredSpreadsheets || []).length ? (
            <div className="registered-list">
              {(settings.registeredSpreadsheets || []).map((entry) => (
                <div className="registered-row" key={entry.spreadsheetId}>
                  <div className="registered-row-main">
                    <div className="registered-row-text">
                      <strong>{entry.name}</strong>
                      <a
                        className="registered-link"
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {entry.url}
                      </a>
                    </div>
                  </div>
                  <div className="registered-row-actions">
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => handleRemoveSpreadsheet(entry.spreadsheetId)}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No spreadsheets registered yet. Click Add to register one.</p>
          )}

          {showAddSpreadsheetForm ? (
            <div className="add-spreadsheet-form">
              <h3 className="section-title">Add spreadsheet</h3>
              <label className="label" htmlFor="new-sheet-name">
                Name
              </label>
              <input
                id="new-sheet-name"
                type="text"
                value={newSheetName}
                onChange={(event) => setNewSheetName(event.target.value)}
                placeholder="Ex: Job applications 2026"
              />
              <label className="label" htmlFor="new-sheet-url">
                Google Sheets link
              </label>
              <input
                id="new-sheet-url"
                type="url"
                value={newSheetUrl}
                onChange={(event) => setNewSheetUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
              <p className="hint">
                Registered names appear in the Chrome extension dropdown for the same Google account.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAddSpreadsheet()}
                disabled={saving}
              >
                Add
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeView === 'filters' ? (
        <section className="card">
          <h2>Skip filters</h2>
          <p className="hint">These filters sync to the Chrome extension for auto-copy.</p>
          <div className="filter-grid">
            <div>
              <label className="label">Company keywords</label>
              <div className="row">
                <input
                  value={companyInput}
                  onChange={(event) => setCompanyInput(event.target.value)}
                  placeholder="Ex: Amazon"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void addFilter('company');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addFilter('company')}
                  disabled={saving}
                >
                  Add
                </button>
              </div>
              <div className="chips">
                {(settings?.filters?.company || []).map((keyword) => (
                  <span className="chip" key={`company-${keyword}`}>
                    {keyword}
                    <button type="button" onClick={() => removeFilter('company', keyword)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Position keywords</label>
              <div className="row">
                <input
                  value={positionInput}
                  onChange={(event) => setPositionInput(event.target.value)}
                  placeholder="Ex: Senior"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void addFilter('position');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addFilter('position')}
                  disabled={saving}
                >
                  Add
                </button>
              </div>
              <div className="chips">
                {(settings?.filters?.position || []).map((keyword) => (
                  <span className="chip" key={`position-${keyword}`}>
                    {keyword}
                    <button type="button" onClick={() => removeFilter('position', keyword)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeView === 'preview' ? (
        <section className="card">
          <div className="section-header">
            <h2>Sheet preview</h2>
            {preview?.sheetName ? <span className="badge">{preview.sheetName}</span> : null}
            {settings?.selectedSheet?.spreadsheetId ? (
              <span className="badge badge-muted">
                {settings.registeredSpreadsheets?.find(
                  (entry) => entry.spreadsheetId === settings.selectedSheet.spreadsheetId
                )?.name || settings.selectedSheet.spreadsheetId}
              </span>
            ) : null}
          </div>

          <label className="label" htmlFor="preview-sheet-tab">
            Target sheet tab
          </label>
          <p className="hint">
            Choose which tab receives copied jobs. This syncs to the Chrome extension.
          </p>
          <select
            id="preview-sheet-tab"
            value={selectedTabId}
            onChange={(event) => handleTabChange(event.target.value)}
            disabled={!sheetTabs.length || saving}
          >
            <option value="">
              {sheetTabs.length
                ? '— Select tab —'
                : '— Select a spreadsheet in the Chrome extension —'}
            </option>
            {sheetTabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.name}
              </option>
            ))}
          </select>

          {!preview ? (
            <p className="muted">
              Select a spreadsheet in the Chrome extension, then choose a tab here to preview rows.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {preview.headers.map((header, index) => (
                      <th key={`header-${index}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.length ? (
                    preview.rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {preview.headers.map((_, cellIndex) => (
                          <td key={`cell-${rowIndex}-${cellIndex}`}>
                            {row[cellIndex] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={preview.headers.length} className="muted">
                        No job rows yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
