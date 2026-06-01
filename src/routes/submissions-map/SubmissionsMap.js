import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import PropTypes from 'prop-types';
import withStyles from 'isomorphic-style-loader/withStyles';
import s from './SubmissionsMap.css';

// ── CONSTANTS ────────────────────────────────────────────────────────────────

const COMPLAINT_COLORS = {
  crosswalk: '#d4ff4e',
  'bike lane': '#4ecbff',
  'red light': '#ff6b35',
  'stop sign': '#ff6b35',
  recklessly: '#ff4466',
  illegally: '#b87fff',
  illegal: '#b87fff',
};

const DEFAULT_MAP_CENTER = [40.72, -73.98];
const DEFAULT_MAP_ZOOM = 12;
const DEFAULT_DRAW_STATUS =
  'Select the polygon tool and draw a shape on the map.';

// ── PURE HELPERS ─────────────────────────────────────────────────────────────

function colorFor(complaint) {
  if (!complaint) return '#7b8698';
  const lower = complaint.toLowerCase();
  for (const [key, color] of Object.entries(COMPLAINT_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return '#7b8698';
}

function makeLeafletIcon(L, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="5" fill="${color}" stroke="#ffffff" stroke-width="2.5"/></svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Parse a JSON array or brace-delimited JSON objects
function parseInput(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);

  const objects = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (trimmed[i] === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(JSON.parse(trimmed.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  if (objects.length > 0) return objects;
  throw new Error(
    'Could not parse input as JSON array or newline-delimited objects.',
  );
}

function polygonToString(vertices) {
  return vertices
    .map(ll => `${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`)
    .join(';');
}

function hasPhotoWithUrl(submission) {
  return Object.keys(submission).some(
    key => key.startsWith('photoData') && submission[key]?.url,
  );
}

function positionPopup(clientX, clientY) {
  const margin = 16;
  const pw = 300;
  const ph = 320;
  let x = clientX + 16;
  let y = clientY - 24;
  if (x + pw > window.innerWidth - margin) x = clientX - pw - 14;
  if (y + ph > window.innerHeight - margin)
    y = window.innerHeight - ph - margin;
  if (y < margin) y = margin;
  return { x, y };
}

// ── POPUP CONTENT ─────────────────────────────────────────────────────────────

function PopupContent({ submission, pinned, onClose }) {
  const photos = [
    submission.photoData0,
    submission.photoData1,
    submission.photoData2,
  ].filter(p => p && p.url);
  const color = colorFor(submission.typeofcomplaint);
  const date = formatDate(submission.timeofreport?.iso);

  return (
    <>
      <div className={s.popupHeader}>
        <div className={s.popupComplaint} style={{ color }}>
          {submission.typeofcomplaint || 'Unknown complaint'}
        </div>
        <div className={s.popupMeta}>
          {submission.license && (
            <div>
              <span className={s.val}>{submission.license}</span>
              {submission.state && (
                <>
                  {' · '}
                  <span className={s.val}>{submission.state}</span>
                </>
              )}
            </div>
          )}
          {submission.loc1_address && (
            <div>
              <span className={s.val}>{submission.loc1_address}</span>
            </div>
          )}
          {date && <div>{date}</div>}
          {submission.reqnumber && (
            <div>
              req <span className={s.val}>{submission.reqnumber}</span>
            </div>
          )}
        </div>
        {pinned && (
          <button
            type="button"
            className={s.popupClose}
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        )}
      </div>
      {photos.length > 0 ? (
        <div className={s.popupPhotos}>
          {photos.map((p, i) => (
            <img
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              src={p.url}
              loading="lazy"
              onError={e => {
                // eslint-disable-next-line no-param-reassign
                e.target.style.display = 'none';
              }}
              alt=""
            />
          ))}
        </div>
      ) : (
        <div className={s.popupNoPhoto}>no photos attached</div>
      )}
    </>
  );
}

PopupContent.propTypes = {
  submission: PropTypes.object.isRequired,
  pinned: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── LEGEND ITEMS ─────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { color: 'var(--smap-crosswalk)', label: 'Blocked crosswalk' },
  { color: 'var(--smap-bikelane)', label: 'Blocked bike lane' },
  { color: 'var(--smap-redlight)', label: 'Ran red light' },
  { color: 'var(--smap-reckless)', label: 'Drove recklessly' },
  { color: 'var(--smap-illegal)', label: 'Illegal parking' },
  { color: '#7b8698', label: 'Other' },
];

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

function SubmissionsMap() {
  // UI state
  const [screen, setScreen] = useState('paste'); // 'paste' | 'map'
  const [activeTab, setActiveTab] = useState('draw'); // 'paste' | 'draw'

  // Data state
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [photosOnly, setPhotosOnly] = useState(false);

  // Form state
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState(null);

  // Draw map status message
  const [drawStatus, setDrawStatus] = useState(DEFAULT_DRAW_STATUS);

  // Popup state: what to show and where
  const [popup, setPopup] = useState({
    visible: false,
    pinned: false,
    submission: null,
    x: 0,
    y: 0,
  });

  // ── REFS (non-reactive Leaflet state) ──────────────────────────────────────

  const LRef = useRef(null); // Leaflet module (loaded async)
  const mapRef = useRef(null); // main Leaflet map instance
  const markerLayerRef = useRef(null); // main marker layer group
  const drawMapRef = useRef(null); // draw-mode Leaflet map
  const drawnItemsRef = useRef(null); // FeatureGroup for drawn polygons
  const currentPolygonStrRef = useRef(null); // polygon currently shown in URL
  const loadedPolygonStrRef = useRef(null); // polygon whose data is loaded

  // DOM element refs
  const mapDivRef = useRef(null);
  const drawMapDivRef = useRef(null);

  // Timer ref for popup hide delay
  const hideTimerRef = useRef(null);

  // ── DERIVED DATA ──────────────────────────────────────────────────────────

  const filteredSubmissions = useMemo(
    () =>
      photosOnly ? allSubmissions.filter(hasPhotoWithUrl) : allSubmissions,
    [allSubmissions, photosOnly],
  );

  // ── URL HELPERS ───────────────────────────────────────────────────────────

  const updateUrl = useCallback((polygonStr, newPhotosOnly, push = true) => {
    const params = new URLSearchParams();
    if (polygonStr) params.set('polygon', polygonStr);
    if (newPhotosOnly) params.set('photosOnly', '1');
    const next = params.toString() ? `?${params}` : window.location.pathname;
    if (push) window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
  }, []);

  const clearUrlParams = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname);
  }, []);

  // ── MARKER RENDERING ─────────────────────────────────────────────────────

  const renderMarkers = useCallback(submissions => {
    const L = LRef.current;
    if (!L || !mapRef.current || !markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    const bounds = [];
    submissions.forEach(sub => {
      const lat = sub.location?.latitude;
      const lng = sub.location?.longitude;
      if (lat == null || lng == null) return;
      bounds.push([lat, lng]);

      const marker = L.marker([lat, lng], {
        icon: makeLeafletIcon(L, colorFor(sub.typeofcomplaint)),
      });

      marker.on('mouseover', e => {
        clearTimeout(hideTimerRef.current);
        setPopup(prev => {
          if (prev.pinned) return prev;
          const { x, y } = positionPopup(
            e.originalEvent.clientX,
            e.originalEvent.clientY,
          );
          return { visible: true, pinned: false, submission: sub, x, y };
        });
      });

      marker.on('mousemove', e => {
        setPopup(prev => {
          if (prev.pinned) return prev;
          const { x, y } = positionPopup(
            e.originalEvent.clientX,
            e.originalEvent.clientY,
          );
          return { ...prev, x, y };
        });
      });

      marker.on('mouseout', () => {
        hideTimerRef.current = setTimeout(() => {
          setPopup(prev => (prev.pinned ? prev : { ...prev, visible: false }));
        }, 90);
      });

      marker.on('click', e => {
        L.DomEvent.stopPropagation(e);
        clearTimeout(hideTimerRef.current);
        const { x, y } = positionPopup(
          e.originalEvent.clientX,
          e.originalEvent.clientY,
        );
        setPopup({ visible: true, pinned: true, submission: sub, x, y });
      });

      markerLayerRef.current.addLayer(marker);
    });

    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 60);
  }, []);

  // ── INIT MAIN MAP ─────────────────────────────────────────────────────────

  const initMainMap = useCallback(() => {
    const L = LRef.current;
    if (!L || !mapDivRef.current || mapRef.current) return;

    const map = L.map(mapDivRef.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', () => {
      setPopup(prev =>
        prev.pinned ? { ...prev, visible: false, pinned: false } : prev,
      );
    });

    mapRef.current = map;
  }, []);

  // ── FETCH POLYGON DATA ────────────────────────────────────────────────────

  const fetchAndLoadPolygon = useCallback(async vertices => {
    setDrawStatus('Loading submissions\u2026');
    const polygonStr = polygonToString(vertices);

    try {
      const resp = await fetch(
        `/api/submissions-in-polygon?polygon=${encodeURIComponent(polygonStr)}`,
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(
          body.error ||
            `Unexpected server error (HTTP ${resp.status}). Please try again.`,
        );
      }
      const data = await resp.json();

      if (!data.results || data.results.length === 0) {
        setAllSubmissions([]);
        loadedPolygonStrRef.current = currentPolygonStrRef.current;
        setDrawStatus(
          'No public submissions found inside this polygon. Try a larger area.',
        );
        return;
      }

      setDrawStatus(DEFAULT_DRAW_STATUS);

      if (data.capped) {
        // eslint-disable-next-line no-alert
        window.alert(
          `Results are capped at ${data.results.length.toLocaleString()} submissions. Draw a smaller polygon to see all reports in an area.`,
        );
      }

      loadedPolygonStrRef.current = currentPolygonStrRef.current;
      setAllSubmissions(data.results);
      setScreen('map');
    } catch (e) {
      setDrawStatus(DEFAULT_DRAW_STATUS);
      const isNetworkError = e instanceof TypeError;
      // eslint-disable-next-line no-alert
      window.alert(
        isNetworkError
          ? 'Network error: could not reach the server. Please check your connection and try again.'
          : `Error: ${e.message}`,
      );
    }
  }, []);

  // ── INIT DRAW MAP ─────────────────────────────────────────────────────────

  const initDrawMap = useCallback(() => {
    const L = LRef.current;
    if (!L || !drawMapDivRef.current) return;

    if (drawMapRef.current) {
      setTimeout(() => drawMapRef.current?.invalidateSize(), 60);
      return;
    }

    const drawMap = L.map(drawMapDivRef.current).setView(
      DEFAULT_MAP_CENTER,
      DEFAULT_MAP_ZOOM,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(drawMap);

    const drawnItems = new L.FeatureGroup().addTo(drawMap);
    drawnItemsRef.current = drawnItems;

    const drawControl = new L.Control.Draw({
      draw: {
        rectangle: false,
        polygon: {
          shapeOptions: { color: '#d4ff4e', weight: 2, fillOpacity: 0.08 },
          allowIntersection: false,
        },
        circle: false,
        polyline: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems, remove: false },
    });
    drawMap.addControl(drawControl);

    drawMap.on(L.Draw.Event.CREATED, async e => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);

      const polygonLatLngs = e.layer.getLatLngs()[0];
      const last = polygonLatLngs[polygonLatLngs.length - 1];
      // Strip the closing duplicate vertex that Leaflet adds
      const vertices =
        polygonLatLngs.length > 1 &&
        polygonLatLngs[0].lat === last.lat &&
        polygonLatLngs[0].lng === last.lng
          ? polygonLatLngs.slice(0, -1)
          : polygonLatLngs;

      currentPolygonStrRef.current = polygonToString(vertices);
      // Read photosOnly from DOM to avoid stale closure
      const photosOnlyParam = new URLSearchParams(window.location.search).get(
        'photosOnly',
      );
      updateUrl(currentPolygonStrRef.current, photosOnlyParam === '1');
      await fetchAndLoadPolygon(vertices);
    });

    drawMapRef.current = drawMap;
    setTimeout(() => drawMap.invalidateSize(), 60);
  }, [fetchAndLoadPolygon, updateUrl]);

  // ── APPLY URL STATE ───────────────────────────────────────────────────────

  // Draws a polygon (from URL) onto the draw map and optionally fetches data.
  const applyPolygonFromUrl = useCallback(
    (polygonStr, shouldFetch) => {
      const L = LRef.current;
      const drawMap = drawMapRef.current;
      const drawnItems = drawnItemsRef.current;
      if (!L || !drawMap || !drawnItems) return;

      const vertices = polygonStr.split(';').map(pair => {
        const [lat, lng] = pair.split(',');
        return [parseFloat(lat), parseFloat(lng)];
      });

      drawnItems.clearLayers();
      const polygon = L.polygon(vertices, {
        color: '#d4ff4e',
        weight: 2,
        fillOpacity: 0.08,
      });
      drawnItems.addLayer(polygon);
      drawMap.fitBounds(polygon.getBounds(), { padding: [20, 20] });

      if (shouldFetch) {
        const latLngs = vertices.map(v => L.latLng(v[0], v[1]));
        fetchAndLoadPolygon(latLngs);
      }
    },
    [fetchAndLoadPolygon],
  );

  // Ref for polygon data to apply after draw map initializes
  const pendingPolygonRef = useRef(null);

  const applyUrlState = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const polygonStr = params.get('polygon');
    const newPhotosOnly = params.get('photosOnly') === '1';

    setPhotosOnly(newPhotosOnly);

    if (polygonStr) {
      const shouldFetch = polygonStr !== loadedPolygonStrRef.current;
      currentPolygonStrRef.current = polygonStr;
      setScreen('paste');
      setActiveTab('draw');
      // applyPolygonFromUrl is called in the draw-tab effect once the map is ready
      // Store what we need to apply
      pendingPolygonRef.current = { polygonStr, shouldFetch };
    } else {
      currentPolygonStrRef.current = null;
      loadedPolygonStrRef.current = null;
      setScreen('paste');
      setPopup(prev => ({ ...prev, visible: false, pinned: false }));
    }
  }, []); // intentionally no deps — applyUrlState reads live refs

  // ── EFFECTS ───────────────────────────────────────────────────────────────

  // Load Leaflet client-side and kick off initial URL state application
  useEffect(() => {
    let cancelled = false;

    Promise.all([import('leaflet'), import('leaflet-draw')]).then(
      ([{ default: L }]) => {
        if (cancelled) return;
        LRef.current = L;

        // Apply URL state now that Leaflet is available.
        // If there's no polygon param, no URL work to do — draw map init
        // happens in the activeTab effect below.
        const hasPolygon = new URLSearchParams(window.location.search).has(
          'polygon',
        );
        if (hasPolygon) {
          applyUrlState();
        }
        // If no polygon, the default activeTab='draw' triggers initDrawMap via effect.
      },
    );

    const handlePopState = () => applyUrlState();
    window.addEventListener('popstate', handlePopState);

    return () => {
      cancelled = true;
      window.removeEventListener('popstate', handlePopState);
      clearTimeout(hideTimerRef.current);
    };
  }, []); // intentionally no deps — effect runs once on mount

  // Initialize the draw map whenever the draw tab is active
  useEffect(() => {
    if (activeTab !== 'draw') return;
    // drawMapDivRef.current may not exist yet on first render; wait for it
    if (!drawMapDivRef.current) return;
    if (!LRef.current) return;

    initDrawMap();

    // If there's a pending polygon from URL state, apply it now
    if (pendingPolygonRef.current) {
      const { polygonStr, shouldFetch } = pendingPolygonRef.current;
      pendingPolygonRef.current = null;
      applyPolygonFromUrl(polygonStr, shouldFetch);
    }
  }, [activeTab, initDrawMap, applyPolygonFromUrl]);

  // Initialize and populate the main map when the map screen becomes active
  useEffect(() => {
    if (screen !== 'map') return;
    if (!LRef.current) return;

    initMainMap();
    renderMarkers(filteredSubmissions);
  }, [screen, filteredSubmissions, initMainMap, renderMarkers]);

  // Re-render markers when the photo filter changes on the map screen
  useEffect(() => {
    if (screen !== 'map' || !mapRef.current) return;
    renderMarkers(filteredSubmissions);
  }, [photosOnly, screen, filteredSubmissions, renderMarkers]);

  // ── HANDLERS ─────────────────────────────────────────────────────────────

  const handleLoadJson = useCallback(() => {
    setJsonError(null);
    const raw = jsonInput.trim();

    if (!raw) {
      setJsonError('Please paste some JSON first.');
      return;
    }

    try {
      const data = parseInput(raw);
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Expected a non-empty array of submission objects.');
      }
      currentPolygonStrRef.current = null;
      loadedPolygonStrRef.current = null;
      updateUrl(null, photosOnly);
      setAllSubmissions(data);
      setScreen('map');
    } catch (e) {
      setJsonError(`Parse error: ${e.message}`);
    }
  }, [jsonInput, photosOnly, updateUrl]);

  const handleReset = useCallback(() => {
    setScreen('paste');
    setPopup(prev => ({ ...prev, visible: false, pinned: false }));
    if (drawnItemsRef.current) drawnItemsRef.current.clearLayers();
    setDrawStatus(DEFAULT_DRAW_STATUS);
    setAllSubmissions([]);
    currentPolygonStrRef.current = null;
    loadedPolygonStrRef.current = null;
    setPhotosOnly(false);
    clearUrlParams();
  }, [clearUrlParams]);

  const handlePhotosOnlyChange = useCallback(
    e => {
      const { checked } = e.target;
      setPhotosOnly(checked);
      updateUrl(currentPolygonStrRef.current, checked);
    },
    [updateUrl],
  );

  const handleClosePopup = useCallback(() => {
    setPopup(prev => ({ ...prev, visible: false, pinned: false }));
  }, []);

  const handleTabPaste = useCallback(() => setActiveTab('paste'), []);
  const handleTabDraw = useCallback(() => {
    setActiveTab('draw');
    // initDrawMap is called by the effect above
  }, []);

  // ── RENDER ────────────────────────────────────────────────────────────────

  const mapScreenActive = screen === 'map';
  const drawTabActive = activeTab === 'draw';

  const popupClasses = [
    s.popup,
    popup.visible ? s.popupVisible : '',
    popup.pinned ? s.popupPinned : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={s.root}>
      {/* PASTE / DRAW SCREEN */}
      {!mapScreenActive && (
        <div
          className={[
            s.pasteScreen,
            drawTabActive ? s.pasteScreenDrawActive : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <h1>Complaint Report Map</h1>

          <div className={s.tabs}>
            <button
              className={[s.tab, !drawTabActive ? s.tabActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={handleTabPaste}
              type="button"
            >
              Paste JSON
            </button>
            <button
              className={[s.tab, drawTabActive ? s.tabActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={handleTabDraw}
              type="button"
            >
              Draw Area
            </button>
          </div>

          {/* Paste panel */}
          {!drawTabActive && (
            <div className={s.panel}>
              <p>
                Paste your JSON below — either a JSON array{' '}
                <code>[&#123;...&#125;, &#123;...&#125;]</code> or
                newline-delimited objects{' '}
                <code>&#123;...&#125;\n&#123;...&#125;</code>.
                <br />
                Each object needs a <code>location</code> with{' '}
                <code>latitude</code> &amp; <code>longitude</code>. Optional:{' '}
                <code>typeofcomplaint</code>, <code>license</code>,{' '}
                <code>loc1_address</code>, <code>timeofreport</code>,{' '}
                <code>photoData0/1/2</code>.
              </p>
              <textarea
                className={s.jsonInput}
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder={`Paste JSON here, e.g.:\n[\n  {\n    "location": { "latitude": 40.686, "longitude": -73.979 },\n    "typeofcomplaint": "Blocked the crosswalk",\n    "license": "T794438C",\n    "state": "NY",\n    "loc1_address": "64 Flatbush Ave, Brooklyn",\n    "timeofreport": { "iso": "2023-04-28T17:04:00.000Z" },\n    "photoData0": { "url": "https://example.com/photo.jpg" },\n    "photoData1": null,\n    "photoData2": null\n  }\n]`}
              />
              {jsonError && <div className={s.errorMsg}>{jsonError}</div>}
              <button
                className={s.loadBtn}
                onClick={handleLoadJson}
                type="button"
              >
                Load Map →
              </button>
            </div>
          )}

          {/* Draw panel */}
          {drawTabActive && (
            <div className={[s.panel, s.drawPanel].join(' ')}>
              <p>
                Draw a polygon on the map to fetch public submissions in that
                area. Click the polygon tool{' '}
                <strong style={{ color: 'var(--smap-text)' }}>⬠</strong> in the
                top-left of the map, then click to add vertices. Double-click to
                finish.
              </p>
              <div
                ref={drawMapDivRef}
                className={[s.drawMap, s.drawMapExpanded].join(' ')}
              />
              <div className={s.drawStatus}>{drawStatus}</div>
            </div>
          )}
        </div>
      )}

      {/* MAP SCREEN */}
      {mapScreenActive && (
        <div className={s.mapScreen}>
          <header className={s.mapHeader}>
            <h1>Complaint Map</h1>
            <span className={s.countBadge}>
              {filteredSubmissions.length} report
              {filteredSubmissions.length !== 1 ? 's' : ''}
            </span>
            <div className={s.legend}>
              {LEGEND_ITEMS.map(({ color, label }) => (
                <div key={label} className={s.legendItem}>
                  <div className={s.legendDot} style={{ background: color }} />
                  {label}
                </div>
              ))}
            </div>
            <label className={s.photoFilter} htmlFor="smapPhotosOnly">
              <input
                type="checkbox"
                id="smapPhotosOnly"
                checked={photosOnly}
                onChange={handlePhotosOnlyChange}
              />
              Photos only
            </label>
            <button className={s.resetBtn} onClick={handleReset} type="button">
              ← New Data
            </button>
          </header>
          <div ref={mapDivRef} className={s.map} />
        </div>
      )}

      {/* HOVER / PINNED POPUP */}
      {popup.submission && (
        <div className={popupClasses} style={{ left: popup.x, top: popup.y }}>
          <PopupContent
            submission={popup.submission}
            pinned={popup.pinned}
            onClose={handleClosePopup}
          />
        </div>
      )}
    </div>
  );
}

export default withStyles(s)(SubmissionsMap);
