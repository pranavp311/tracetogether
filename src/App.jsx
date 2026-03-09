import React, { useState, useRef, useEffect, useCallback } from 'react'

// ─── Constants ───────────────────────────────────────────────────────────────
const BLUETOOTH_RANGE_M = 2.0
const TIME_THRESHOLD_MIN = 15
const PIXELS_PER_METRE = 60 // 1m = 60px
const PERSON_RADIUS = 16
const GRID_SPACING = 20
const CANVAS_W = 800
const CANVAS_H = 500

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f0f0f',
  grid: '#1a1a1a',
  wall: '#555555',
  person: '#e0e0e0',
  personFlagged: '#f59e0b',
  btRange: 'rgba(59,130,246,0.15)',
  lineReal: '#22c55e',
  lineFalse: '#ef4444',
  linePending: '#666666',
  specAccent: '#3b82f6',
  execAccent: '#ef4444',
}

// ─── Scenario Presets ────────────────────────────────────────────────────────
const PRESETS = {
  hdb: {
    label: 'HDB Flat',
    persons: [
      { id: 'a', x: 5.5, y: 3.5, label: 'Resident A' },
      { id: 'b', x: 7.5, y: 3.5, label: 'Resident B' },
    ],
    walls: [{ x1: 6.5, y1: 1, x2: 6.5, y2: 7 }],
    roomLabels: [
      { text: 'Unit #12-301', x: 3.25, y: 0.8 },
      { text: 'Unit #12-302', x: 9.75, y: 0.8 },
    ],
  },
  dormitory: {
    label: 'Migrant Worker Dormitory',
    persons: [
      { id: 'w1', x: 1.5, y: 2.5, label: 'Worker 1' },
      { id: 'w2', x: 2.5, y: 5.0, label: 'Worker 2' },
      { id: 'w3', x: 4.2, y: 2.5, label: 'Worker 3' },
      { id: 'w4', x: 5.2, y: 5.0, label: 'Worker 4' },
      { id: 'w5', x: 7.0, y: 2.5, label: 'Worker 5' },
      { id: 'w6', x: 8.0, y: 5.0, label: 'Worker 6' },
      { id: 'w7', x: 9.8, y: 2.5, label: 'Worker 7' },
      { id: 'w8', x: 10.8, y: 5.0, label: 'Worker 8' },
    ],
    walls: [
      { x1: 3.33, y1: 0.8, x2: 3.33, y2: 7 },
      { x1: 6.16, y1: 0.8, x2: 6.16, y2: 7 },
      { x1: 9.0, y1: 0.8, x2: 9.0, y2: 7 },
    ],
    roomLabels: [
      { text: 'Room 1', x: 1.7, y: 0.8 },
      { text: 'Room 2', x: 4.75, y: 0.8 },
      { text: 'Room 3', x: 7.58, y: 0.8 },
      { text: 'Room 4', x: 10.4, y: 0.8 },
    ],
  },
  mall: {
    label: 'Open Mall',
    persons: [
      { id: 'm1', x: 3, y: 2, label: 'Shopper A' },
      { id: 'm2', x: 3.8, y: 3.2, label: 'Shopper B' },
      { id: 'm3', x: 7, y: 2, label: 'Shopper C' },
      { id: 'm4', x: 10, y: 5, label: 'Shopper D' },
      { id: 'm5', x: 5.5, y: 6, label: 'Shopper E' },
    ],
    walls: [],
    roomLabels: [{ text: 'Mall Atrium', x: 6.5, y: 0.8 }],
  },
  custom: {
    label: 'Custom',
    persons: [],
    walls: [],
    roomLabels: [],
  },
}

// ─── Geometry helpers ────────────────────────────────────────────────────────
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

function anyWallBetween(a, b, walls) {
  for (const w of walls) {
    if (segmentsIntersect(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) {
      return true
    }
  }
  return false
}

function evaluateHandshakes(persons, walls, mode, timeElapsed) {
  const handshakes = []
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const d = dist(persons[i], persons[j])
      if (d > BLUETOOTH_RANGE_M) continue
      const wallBetween = anyWallBetween(persons[i], persons[j], walls)
      let active = false
      let isFalsePositive = false
      if (mode === 'specification') {
        active = !wallBetween && timeElapsed >= TIME_THRESHOLD_MIN
        isFalsePositive = false
      } else {
        active = timeElapsed >= TIME_THRESHOLD_MIN
        isFalsePositive = wallBetween
      }
      handshakes.push({
        personA: persons[i].id,
        personB: persons[j].id,
        labelA: persons[i].label,
        labelB: persons[j].label,
        distance: d,
        throughWall: wallBetween,
        isFalsePositive,
        active,
        stateAction: active ? 'Isolation Order' : 'No Action',
        pending: !active && d <= BLUETOOTH_RANGE_M && timeElapsed < TIME_THRESHOLD_MIN && (mode === 'execution' || !wallBetween),
      })
    }
  }
  return handshakes
}

// ─── Convert metres to canvas px ─────────────────────────────────────────────
function m2px(m) { return m * PIXELS_PER_METRE }

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [scenario, setScenario] = useState('hdb')
  const [mode, setMode] = useState('specification')
  const [persons, setPersons] = useState(PRESETS.hdb.persons)
  const [walls, setWalls] = useState(PRESETS.hdb.walls)
  const [roomLabels, setRoomLabels] = useState(PRESETS.hdb.roomLabels)
  const [timeElapsed, setTimeElapsed] = useState(0)
  const [dragging, setDragging] = useState(null)
  const [hoveredLine, setHoveredLine] = useState(null)
  const [drawingWall, setDrawingWall] = useState(false)
  const [wallStart, setWallStart] = useState(null)
  const [wallPreview, setWallPreview] = useState(null)
  const [modeFlash, setModeFlash] = useState(false)
  const canvasRef = useRef(null)
  const animRef = useRef(0)

  const handshakes = evaluateHandshakes(persons, walls, mode, timeElapsed)

  // Stats
  const realContacts = handshakes.filter(h => h.active && !h.isFalsePositive).length
  const falsePositives = handshakes.filter(h => h.active && h.isFalsePositive).length
  const isolationOrders = handshakes.filter(h => h.active).length

  // Load preset
  const loadPreset = useCallback((key) => {
    const p = PRESETS[key]
    setScenario(key)
    setPersons(p.persons.map(pp => ({ ...pp })))
    setWalls(p.walls.map(w => ({ ...w })))
    setRoomLabels(p.roomLabels.map(r => ({ ...r })))
    setTimeElapsed(0)
    setDragging(null)
    setHoveredLine(null)
    setDrawingWall(false)
    setWallStart(null)
    setWallPreview(null)
  }, [])

  // Mode toggle with flash
  const toggleMode = useCallback(() => {
    setMode(m => m === 'specification' ? 'execution' : 'specification')
    setModeFlash(true)
    setTimeout(() => setModeFlash(false), 1500)
  }, [])

  // Add person in custom mode
  const addPerson = useCallback((mx, my) => {
    if (persons.length >= 8) return
    const id = String.fromCharCode(97 + persons.length)
    setPersons(prev => [...prev, {
      id,
      x: mx / PIXELS_PER_METRE,
      y: my / PIXELS_PER_METRE,
      label: `Person ${prev.length + 1}`,
    }])
  }, [persons.length])

  // ─── Canvas drawing ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let frame
    const pulseSpeed = 0.003

    function draw(time) {
      const pulse = 0.5 + 0.5 * Math.sin(time * pulseSpeed)

      // Background
      ctx.fillStyle = C.bg
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Grid
      ctx.strokeStyle = C.grid
      ctx.lineWidth = 0.5
      for (let x = 0; x <= CANVAS_W; x += GRID_SPACING) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke()
      }
      for (let y = 0; y <= CANVAS_H; y += GRID_SPACING) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke()
      }

      // Room labels
      ctx.font = '11px monospace'
      ctx.fillStyle = '#444'
      ctx.textAlign = 'center'
      for (const rl of roomLabels) {
        ctx.fillText(rl.text, m2px(rl.x), m2px(rl.y))
      }

      // Walls
      ctx.strokeStyle = C.wall
      ctx.lineWidth = 4
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 6
      for (const w of walls) {
        ctx.beginPath()
        ctx.moveTo(m2px(w.x1), m2px(w.y1))
        ctx.lineTo(m2px(w.x2), m2px(w.y2))
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      // Wall preview while drawing
      if (wallPreview && wallStart) {
        ctx.strokeStyle = '#888'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(m2px(wallStart.x), m2px(wallStart.y))
        ctx.lineTo(m2px(wallPreview.x), m2px(wallPreview.y))
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Bluetooth range circles
      ctx.lineWidth = 1
      for (const p of persons) {
        ctx.strokeStyle = C.btRange
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.arc(m2px(p.x), m2px(p.y), m2px(BLUETOOTH_RANGE_M), 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Handshake lines
      for (const h of handshakes) {
        const pA = persons.find(p => p.id === h.personA)
        const pB = persons.find(p => p.id === h.personB)
        if (!pA || !pB) continue

        if (h.active) {
          if (h.isFalsePositive) {
            ctx.strokeStyle = `rgba(239,68,68,${0.5 + 0.5 * pulse})`
            ctx.lineWidth = 2.5
          } else {
            ctx.strokeStyle = C.lineReal
            ctx.lineWidth = 2
          }
          ctx.setLineDash([])
        } else if (h.pending) {
          ctx.strokeStyle = C.linePending
          ctx.lineWidth = 1
          ctx.setLineDash([5, 5])
        } else {
          continue
        }

        ctx.beginPath()
        ctx.moveTo(m2px(pA.x), m2px(pA.y))
        ctx.lineTo(m2px(pB.x), m2px(pB.y))
        ctx.stroke()
        ctx.setLineDash([])

        // Distance label on line
        const mx = (m2px(pA.x) + m2px(pB.x)) / 2
        const my = (m2px(pA.y) + m2px(pB.y)) / 2
        ctx.font = '9px monospace'
        ctx.fillStyle = '#888'
        ctx.textAlign = 'center'
        ctx.fillText(`${h.distance.toFixed(1)}m`, mx, my - 6)
      }

      // Person circles
      for (const p of persons) {
        const px = m2px(p.x)
        const py = m2px(p.y)
        const isFlagged = handshakes.some(h =>
          h.active && (h.personA === p.id || h.personB === p.id)
        )
        const isFalseFlagged = handshakes.some(h =>
          h.active && h.isFalsePositive && (h.personA === p.id || h.personB === p.id)
        )

        // Glow ring if flagged
        if (isFlagged) {
          ctx.beginPath()
          ctx.arc(px, py, PERSON_RADIUS + 6, 0, Math.PI * 2)
          const glowColor = isFalseFlagged ? `rgba(239,68,68,${0.2 + 0.2 * pulse})` : `rgba(34,197,94,${0.2 + 0.15 * pulse})`
          ctx.fillStyle = glowColor
          ctx.fill()
        }

        // Main circle
        ctx.beginPath()
        ctx.arc(px, py, PERSON_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = isFlagged ? (isFalseFlagged ? C.personFlagged : '#a3e635') : C.person
        ctx.fill()

        // Icon inside circle (simple person silhouette)
        ctx.fillStyle = '#0f0f0f'
        ctx.beginPath()
        ctx.arc(px, py - 3, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(px, py + 5, 6, 4, 0, Math.PI, 0, true)
        ctx.fill()

        // Label
        ctx.font = '10px monospace'
        ctx.fillStyle = '#ccc'
        ctx.textAlign = 'center'
        ctx.fillText(p.label, px, py + PERSON_RADIUS + 14)
      }

      // Mode flash banner
      if (modeFlash) {
        ctx.fillStyle = mode === 'execution'
          ? 'rgba(239,68,68,0.12)'
          : 'rgba(59,130,246,0.12)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

        ctx.font = '13px monospace'
        ctx.fillStyle = mode === 'execution' ? '#ef4444' : '#3b82f6'
        ctx.textAlign = 'center'
        ctx.fillText(
          'Material properties of Bluetooth reshape who is flagged',
          CANVAS_W / 2,
          CANVAS_H - 20
        )
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [persons, walls, roomLabels, handshakes, mode, modeFlash, wallPreview, wallStart])

  // ─── Mouse interaction ────────────────────────────────────────────────────
  const getCanvasPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const handleMouseDown = useCallback((e) => {
    const pos = getCanvasPos(e)
    const mx = pos.x / PIXELS_PER_METRE
    const my = pos.y / PIXELS_PER_METRE

    // Wall drawing mode
    if (drawingWall && scenario === 'custom') {
      if (!wallStart) {
        setWallStart({ x: mx, y: my })
      } else {
        setWalls(prev => [...prev, { x1: wallStart.x, y1: wallStart.y, x2: mx, y2: my }])
        setWallStart(null)
        setWallPreview(null)
      }
      return
    }

    // Check if clicking a person
    for (const p of persons) {
      if (dist({ x: mx, y: my }, p) < PERSON_RADIUS / PIXELS_PER_METRE + 0.15) {
        setDragging(p.id)
        return
      }
    }

    // Custom mode: add person on empty space
    if (scenario === 'custom' && !drawingWall) {
      addPerson(pos.x, pos.y)
    }
  }, [persons, getCanvasPos, scenario, drawingWall, wallStart, addPerson])

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    const mx = pos.x / PIXELS_PER_METRE
    const my = pos.y / PIXELS_PER_METRE

    if (dragging) {
      setPersons(prev => prev.map(p =>
        p.id === dragging ? { ...p, x: mx, y: my } : p
      ))
      return
    }

    if (drawingWall && wallStart) {
      setWallPreview({ x: mx, y: my })
      return
    }

    // Hover detection on handshake lines
    let found = null
    for (const h of handshakes) {
      const pA = persons.find(p => p.id === h.personA)
      const pB = persons.find(p => p.id === h.personB)
      if (!pA || !pB || (!h.active && !h.pending)) continue
      const lineLen = dist(pA, pB)
      if (lineLen < 0.01) continue
      const t = Math.max(0, Math.min(1,
        ((mx - pA.x) * (pB.x - pA.x) + (my - pA.y) * (pB.y - pA.y)) / (lineLen * lineLen)
      ))
      const closest = { x: pA.x + t * (pB.x - pA.x), y: pA.y + t * (pB.y - pA.y) }
      if (dist({ x: mx, y: my }, closest) < 0.3) {
        found = h
        break
      }
    }
    setHoveredLine(found)
  }, [dragging, persons, handshakes, getCanvasPos, drawingWall, wallStart])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  // ─── Tooltip text ─────────────────────────────────────────────────────────
  function getTooltipText(h) {
    if (!h) return null
    if (h.active && !h.isFalsePositive) {
      return 'Schema captures: proximity + duration \u2192 classified as Close Contact'
    }
    if (h.active && h.isFalsePositive) {
      return 'Dourish (2022): the gap between specification and execution \u2014 Bluetooth penetrates this wall, producing a false contact'
    }
    if (h.pending) {
      return 'Detected \u2014 awaiting 15-minute threshold'
    }
    return null
  }

  // ─── Right-click to remove wall in custom mode ────────────────────────────
  const handleContextMenu = useCallback((e) => {
    if (scenario !== 'custom') return
    e.preventDefault()
    const pos = getCanvasPos(e)
    const mx = pos.x / PIXELS_PER_METRE
    const my = pos.y / PIXELS_PER_METRE

    // Find nearest wall within 0.3m
    let closestIdx = -1
    let closestDist = 0.3
    walls.forEach((w, idx) => {
      const len = dist({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })
      if (len < 0.01) return
      const t = Math.max(0, Math.min(1,
        ((mx - w.x1) * (w.x2 - w.x1) + (my - w.y1) * (w.y2 - w.y1)) / (len * len)
      ))
      const closest = { x: w.x1 + t * (w.x2 - w.x1), y: w.y1 + t * (w.y2 - w.y1) }
      const d = dist({ x: mx, y: my }, closest)
      if (d < closestDist) {
        closestDist = d
        closestIdx = idx
      }
    })
    if (closestIdx >= 0) {
      setWalls(prev => prev.filter((_, i) => i !== closestIdx))
    }
  }, [scenario, walls, getCanvasPos])

  // ─── Render ───────────────────────────────────────────────────────────────
  const accentColor = mode === 'specification' ? C.specAccent : C.execAccent

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0a0a0a' }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', letterSpacing: '0.05em' }}>
            TRACETOGETHER HANDSHAKE SIMULATOR
          </h1>
          <p style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            Bluetooth proximity detection &mdash; specification vs. execution
          </p>
        </div>
        <div style={{ fontSize: 10, color: '#555', maxWidth: 320, textAlign: 'right', lineHeight: 1.5 }}>
          Accompanying: <em>Coding Health Risk onto the Body</em> (Pappu, 2026)
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
        {/* Main canvas area */}
        <div style={{ flex: 1, minWidth: 600, padding: 16, position: 'relative' }}>
          {/* Stats overlay */}
          <div style={{
            position: 'absolute',
            top: 24,
            right: 24,
            background: 'rgba(15,15,15,0.9)',
            border: '1px solid #222',
            padding: '12px 16px',
            zIndex: 10,
            fontSize: 12,
            lineHeight: 1.8,
            minWidth: 200,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Real Contacts:</span>
              <span style={{ color: C.lineReal, fontWeight: 600 }}>{realContacts}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>False Positives:</span>
              <span style={{ color: C.lineFalse, fontWeight: 600 }}>{falsePositives}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Isolation Orders:</span>
              <span style={{ color: C.personFlagged, fontWeight: 600 }}>{isolationOrders}</span>
            </div>
            <div style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid #222',
              fontSize: 10,
              color: '#555',
              fontStyle: 'italic',
              lineHeight: 1.5,
            }}>
              "The state cannot distinguish real from false contacts.
              All produce the same enforceable consequence."
            </div>
          </div>

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              cursor: dragging ? 'grabbing' : (drawingWall ? 'crosshair' : 'default'),
              border: `1px solid ${accentColor}33`,
              borderRadius: 4,
              display: 'block',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleContextMenu}
          />

          {/* Tooltip */}
          {hoveredLine && (
            <div style={{
              position: 'absolute',
              bottom: 24,
              left: 24,
              background: 'rgba(15,15,15,0.95)',
              border: `1px solid ${hoveredLine.isFalsePositive ? C.lineFalse : hoveredLine.active ? C.lineReal : '#444'}`,
              padding: '10px 14px',
              fontSize: 11,
              color: '#ccc',
              maxWidth: 420,
              lineHeight: 1.6,
              fontStyle: 'italic',
              zIndex: 10,
            }}>
              {getTooltipText(hoveredLine)}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div style={{
          width: 320,
          borderLeft: '1px solid #1a1a1a',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          overflowY: 'auto',
        }}>
          {/* Mode Toggle */}
          <div>
            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Mode
            </div>
            <button
              onClick={toggleMode}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: mode === 'specification' ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${accentColor}55`,
                color: accentColor,
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                textAlign: 'left',
                borderRadius: 4,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {mode === 'specification' ? 'SPECIFICATION' : 'EXECUTION'}
              </div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                {mode === 'specification'
                  ? 'Ideal: Walls Block Signal'
                  : 'Real: Bluetooth Penetrates Walls'}
              </div>
            </button>
            <div style={{ fontSize: 9, color: '#555', marginTop: 6 }}>
              Click to toggle between idealised and real Bluetooth behaviour
            </div>
          </div>

          {/* Scenario Presets */}
          <div>
            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Scenario
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(PRESETS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => loadPreset(key)}
                  style={{
                    padding: '8px 12px',
                    background: scenario === key ? '#1a1a1a' : 'transparent',
                    border: `1px solid ${scenario === key ? '#333' : '#1a1a1a'}`,
                    color: scenario === key ? '#e0e0e0' : '#666',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    borderRadius: 3,
                    transition: 'all 0.15s',
                  }}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom mode tools */}
          {scenario === 'custom' && (
            <div>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Custom Tools
              </div>
              <button
                onClick={() => { setDrawingWall(d => !d); setWallStart(null); setWallPreview(null) }}
                style={{
                  padding: '8px 12px',
                  background: drawingWall ? 'rgba(85,85,85,0.2)' : 'transparent',
                  border: `1px solid ${drawingWall ? '#555' : '#222'}`,
                  color: drawingWall ? '#e0e0e0' : '#888',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  borderRadius: 3,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                {drawingWall ? 'Drawing Walls (click to cancel)' : 'Draw Wall'}
              </button>
              <div style={{ fontSize: 9, color: '#555', marginTop: 6, lineHeight: 1.5 }}>
                Click canvas to place persons (max 8).
                {drawingWall ? ' Click two points to draw a wall. Right-click a wall to remove.' : ''}
              </div>
            </div>
          )}

          {/* Time Control */}
          <div>
            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Time: {timeElapsed} min
            </div>
            <div style={{
              width: '100%',
              height: 4,
              background: '#1a1a1a',
              borderRadius: 2,
              marginBottom: 8,
              position: 'relative',
            }}>
              <div style={{
                width: `${(timeElapsed / 30) * 100}%`,
                height: '100%',
                background: timeElapsed >= TIME_THRESHOLD_MIN ? accentColor : '#444',
                borderRadius: 2,
                transition: 'width 0.3s',
              }} />
              {/* 15-min marker */}
              <div style={{
                position: 'absolute',
                left: `${(15 / 30) * 100}%`,
                top: -2,
                width: 1,
                height: 8,
                background: '#666',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setTimeElapsed(t => Math.min(30, t + 15))}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'transparent',
                  border: '1px solid #222',
                  color: '#e0e0e0',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  borderRadius: 3,
                }}
              >
                +15 min
              </button>
              <button
                onClick={() => setTimeElapsed(0)}
                style={{
                  padding: '8px 12px',
                  background: 'transparent',
                  border: '1px solid #222',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  borderRadius: 3,
                }}
              >
                Reset
              </button>
            </div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 6 }}>
              TraceTogether required 15 min proximity to register a handshake
            </div>
          </div>

          {/* Handshake Table */}
          <div>
            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Detected Interactions
            </div>
            {handshakes.length === 0 ? (
              <div style={{ fontSize: 11, color: '#444', fontStyle: 'italic' }}>
                No persons within Bluetooth range
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {handshakes.map((h, i) => (
                  <div
                    key={`${h.personA}-${h.personB}`}
                    style={{
                      padding: '8px 10px',
                      background: h.active
                        ? (h.isFalsePositive ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)')
                        : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${h.active
                        ? (h.isFalsePositive ? '#ef444433' : '#22c55e33')
                        : '#1a1a1a'}`,
                      borderRadius: 3,
                      fontSize: 10,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#ccc' }}>
                        {h.labelA} &harr; {h.labelB}
                      </span>
                      <span style={{ color: '#888' }}>{h.distance.toFixed(1)}m</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <span style={{
                        color: h.active
                          ? (h.isFalsePositive ? C.lineFalse : C.lineReal)
                          : (h.pending ? '#888' : '#444'),
                        fontWeight: h.active ? 600 : 400,
                      }}>
                        {h.active
                          ? (h.isFalsePositive ? 'False Positive' : 'Close Contact')
                          : (h.pending ? 'Awaiting threshold' : 'Out of range')}
                      </span>
                      <span style={{
                        color: h.active ? C.personFlagged : '#444',
                        fontWeight: h.active ? 600 : 400,
                      }}>
                        {h.stateAction}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        padding: '12px 24px',
        borderTop: '1px solid #1a1a1a',
        fontSize: 10,
        color: '#444',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span>Drag persons to reposition. Hover lines for annotations.</span>
        <span>NUS Coding Mortality Junior Seminar</span>
      </footer>
    </div>
  )
}
