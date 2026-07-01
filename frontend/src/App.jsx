import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
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

const NAV_ITEMS = [
  {
    id: 'spreadsheets',
    label: 'Spreadsheets',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    )
  },
  {
    id: 'filters',
    label: 'Filters',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M7 12h10M10 18h4" />
      </svg>
    )
  },
  {
    id: 'preview',
    label: 'Preview',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16v12H4V6z" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    )
  }
];

function userInitial(email) {
  return (String(email || '?')[0] || '?').toUpperCase();
}

export default function App() {
  const [authConfig, setAuthConfig] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [settings, setSettings] = useState(null);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');
  const [showAddSpreadsheetForm, setShowAddSpreadsheetForm] = useState(false);
  const [previewSpreadsheetId, setPreviewSpreadsheetId] = useState('');
  const [sheetTabs, setSheetTabs] = useState([]);
  const [preview, setPreview] = useState(null);
  const [companyInput, setCompanyInput] = useState('');
  const [positionInput, setPositionInput] = useState('');
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

      const spreadsheetId = nextSettings.selectedSheet?.spreadsheetId || null;
      setPreviewSpreadsheetId(spreadsheetId || '');

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
    const toastId = toast.loading('Signing in…');
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
      toast.success('Signed in.', { id: toastId });
      await refreshDashboard(nextSession);
    } catch (err) {
      toast.dismiss(toastId);
      const message = err?.message || 'Google sign-in failed.';
      if (/origin|invalid_client|401/i.test(message)) {
        setError(
          `${message} Add ${window.location.origin} under Authorized JavaScript origins for OAuth client ${authConfig?.googleClientId || ''} in Google Cloud Console, then wait 1–2 minutes and try again.`
        );
      } else {
        setError(message);
      }
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
    setPreviewSpreadsheetId('');
    setSheetTabs([]);
    setPreview(null);
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
    const toastId = toast.loading('Saving…');
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
      toast.success('Spreadsheet registered.', { id: toastId });
    } catch (err) {
      toast.dismiss(toastId);
      setError(err.message);
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
      toast.success('Spreadsheet removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSpreadsheetChange(spreadsheetId) {
    if (!session || !settings) {
      return;
    }

    setPreviewSpreadsheetId(spreadsheetId);
    setPreview(null);
    setSheetTabs([]);
    setError('');

    if (!spreadsheetId) {
      return;
    }

    setSaving(true);
    try {
      const tabsData = await fetchSheetTabs(
        session.platformToken,
        session.googleAccessToken,
        spreadsheetId
      );
      setSheetTabs(tabsData.sheets || []);

      if (settings.selectedSheet?.spreadsheetId !== spreadsheetId) {
        const data = await saveSettings(session.platformToken, session.googleAccessToken, {
          ...settingsPayload(settings),
          selectedSheet: null
        });
        setSettings(data.settings);
      }
      toast.success('Spreadsheet selected. Choose a sheet tab to preview.');
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

    const spreadsheetId = previewSpreadsheetId || settings.selectedSheet?.spreadsheetId;
    if (!spreadsheetId) {
      return;
    }

    const match = sheetTabs.find((tab) => String(tab.id) === String(sheetId));
    if (!match) {
      return;
    }

    const selectedSheet = {
      spreadsheetId,
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
      toast.success('Target tab updated.');
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
      toast.success('Filters updated.');
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
        <div className="login-card">
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
    <div className="page page-dashboard">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z" />
                <path d="M5 5h6v2H7v10h10v-4h2v6H5V5z" />
              </svg>
            </span>
            <div className="app-brand-text">
              <h1>Job Info Copier</h1>
              <p className="app-tagline">Manage spreadsheets, filters, and job previews</p>
            </div>
          </div>

          <div className="app-user">
            <div className="user-chip" title={session.user?.email}>
              <span className="user-avatar">{userInitial(session.user?.email)}</span>
              <span className="user-email">{session.user?.email}</span>
            </div>
            <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>

        <nav className="app-nav" aria-label="Dashboard sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-nav-link${activeView === item.id ? ' app-nav-link-active' : ''}`}
              onClick={() => setActiveView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className={`app-main${activeView === 'preview' ? ' app-main-preview' : ''}`}>
      {error ? <p className="alert alert-error">{error}</p> : null}

      {activeView === 'spreadsheets' ? (
        <section>
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
        <section>
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
        <section className="preview-section">
          <div className="preview-toolbar">
            <h2>Sheet preview</h2>
            <div className="preview-control preview-control-spreadsheet">
              <label className="preview-label" htmlFor="preview-spreadsheet">
                Spreadsheet
              </label>
              <select
                id="preview-spreadsheet"
                className="preview-select"
                value={previewSpreadsheetId}
                onChange={(event) => void handleSpreadsheetChange(event.target.value)}
                disabled={!(settings?.registeredSpreadsheets || []).length || saving}
                title="Choose a registered Google spreadsheet"
              >
                <option value="">
                  {(settings?.registeredSpreadsheets || []).length
                    ? 'Select spreadsheet'
                    : 'Register a spreadsheet first'}
                </option>
                {(settings?.registeredSpreadsheets || []).map((entry) => (
                  <option key={entry.spreadsheetId} value={entry.spreadsheetId}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="preview-workspace">
            <div className="table-wrap preview-table-wrap">
              {!previewSpreadsheetId ? (
                <p className="preview-empty muted">Select a spreadsheet to begin.</p>
              ) : !selectedTabId ? (
                <p className="preview-empty muted">Choose a sheet tab below to preview rows.</p>
              ) : !preview ? (
                <p className="preview-empty muted">Loading preview…</p>
              ) : (
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
              )}
            </div>

            <div className="sheet-tabs-bar" role="tablist" aria-label="Sheet tabs">
              {previewSpreadsheetId && sheetTabs.length > 0 ? (
                sheetTabs.map((tab) => {
                  const tabId = String(tab.id);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedTabId === tabId}
                      className={`sheet-tab${selectedTabId === tabId ? ' sheet-tab-active' : ''}`}
                      onClick={() => void handleTabChange(tabId)}
                      disabled={saving}
                    >
                      {tab.name ?? tab.sheetName}
                    </button>
                  );
                })
              ) : (
                <span className="sheet-tabs-empty muted">
                  {!previewSpreadsheetId
                    ? 'Select a spreadsheet to load sheet tabs'
                    : 'Loading sheet tabs…'}
                </span>
              )}
            </div>
          </div>
        </section>
      ) : null}
      </main>
    </div>
  );
}
