import React, { useState, useRef, useEffect, useCallback } from 'react'

// ─── Constants ───────────────────────────────────────────────────────────────
const BLUETOOTH_RANGE_M = 2.0
const TIME_THRESHOLD_MIN = 15
const PIXELS_PER_METRE = 60
const PERSON_RADIUS = 16
const CANVAS_W = 800
const CANVAS_H = 490

// ASCII grid dimensions
const CELL_W = 8
const CELL_H = 14
const COLS = Math.floor(CANVAS_W / CELL_W)   // 100
const ROWS = Math.floor(CANVAS_H / CELL_H)   // 35
const FONT_SIZE = 12

// AcerolaFX-inspired character ramps
const LUM_RAMP = ' .:-=+*#%@'
const EDGE_CHARS = ['|', '-', '/', '\\']

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f0f0f',
  grid: '#1a1a1a',
  gridDot: '#222222',
  wall: '#666666',
  wallChar: '#888888',
  person: '#e0e0e0',
  personFlagged: '#f59e0b',
  btRange: '#1a2a3a',
  btRangeChar: '#2a3a5a',
  lineReal: '#22c55e',
  lineFalse: '#ef4444',
  linePending: '#555555',
  specAccent: '#3b82f6',
  execAccent: '#ef4444',
  glowGreen: '#22c55e',
  glowRed: '#ef4444',
  label: '#555555',
  roomLabel: '#333333',
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

// ─── Coordinate conversions ──────────────────────────────────────────────────
function m2px(m) { return m * PIXELS_PER_METRE }
function m2col(m) { return Math.round(m * PIXELS_PER_METRE / CELL_W) }
function m2row(m) { return Math.round(m * PIXELS_PER_METRE / CELL_H) }

// ─── ASCII rasterization helpers ─────────────────────────────────────────────
function createGrid() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ char: ' ', fg: C.bg, priority: 0 }))
  )
}

function setCell(grid, col, row, char, fg, priority = 1) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return
  if (grid[row][col].priority > priority) return
  grid[row][col] = { char, fg, priority }
}

// Bresenham's line algorithm returning cells with directional chars
function bresenhamLine(x0, y0, x1, y1) {
  const points = []
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let cx = x0, cy = y0
  // Choose direction character based on overall line angle
  const adx = x1 - x0, ady = y1 - y0
  const angle = Math.atan2(ady, adx)
  const a = Math.abs(angle)
  let ch
  if (a < Math.PI / 6 || a > 5 * Math.PI / 6) ch = '-'
  else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) ch = '|'
  else if ((angle > 0 && angle < Math.PI / 2) || (angle < -Math.PI / 2 && angle > -Math.PI)) ch = '\\'
  else ch = '/'

  const maxSteps = dx + dy + 2
  for (let step = 0; step <= maxSteps; step++) {
    points.push({ col: cx, row: cy, char: ch })
    if (cx === x1 && cy === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; cx += sx }
    if (e2 < dx) { err += dx; cy += sy }
  }
  return points
}

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
    setTimeout(() => setModeFlash(false), 1800)
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

  // ─── ASCII Canvas drawing ─────────────────────────────────────────────────
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

      // Clear
      ctx.fillStyle = C.bg
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Build ASCII grid
      const grid = createGrid()

      // Layer 1: Background dot matrix
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (col % 5 === 0 && row % 3 === 0) {
            setCell(grid, col, row, '.', C.gridDot, 0)
          } else if (col % 10 === 0 && row % 6 === 0) {
            setCell(grid, col, row, '+', '#1e1e1e', 0)
          }
        }
      }

      // Layer 2: Room labels
      for (const rl of roomLabels) {
        const col = m2col(rl.x) - Math.floor(rl.text.length / 2)
        const row = m2row(rl.y)
        for (let i = 0; i < rl.text.length; i++) {
          setCell(grid, col + i, row, rl.text[i], C.roomLabel, 1)
        }
      }

      // Layer 3: Bluetooth range circles (ellipses in char space)
      for (const p of persons) {
        const cx = m2col(p.x)
        const cy = m2row(p.y)
        const rxCells = BLUETOOTH_RANGE_M * PIXELS_PER_METRE / CELL_W
        const ryCells = BLUETOOTH_RANGE_M * PIXELS_PER_METRE / CELL_H

        for (let row = Math.max(0, Math.floor(cy - ryCells - 1)); row <= Math.min(ROWS - 1, Math.ceil(cy + ryCells + 1)); row++) {
          for (let col = Math.max(0, Math.floor(cx - rxCells - 1)); col <= Math.min(COLS - 1, Math.ceil(cx + rxCells + 1)); col++) {
            const ndx = (col - cx) / rxCells
            const ndy = (row - cy) / ryCells
            const d = Math.sqrt(ndx * ndx + ndy * ndy)
            // Circle boundary
            if (d > 0.85 && d < 1.15) {
              // Pick directional char for the circle
              const angle = Math.atan2(ndy, ndx)
              const a = Math.abs(angle)
              let ch = '.'
              if (a < Math.PI / 6 || a > 5 * Math.PI / 6) ch = '-'
              else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) ch = '|'
              else if ((angle > Math.PI / 6 && angle < Math.PI / 3) || (angle < -2 * Math.PI / 3 && angle > -5 * Math.PI / 6)) ch = '\\'
              else ch = '/'
              setCell(grid, col, row, ch, C.btRangeChar, 1)
            }
            // Subtle fill inside range
            if (d < 0.85 && d > 0.3) {
              if ((col + row) % 4 === 0) {
                setCell(grid, col, row, '.', C.btRange, 0)
              }
            }
          }
        }
      }

      // Layer 4: Walls (rasterize as solid block chars)
      for (const w of walls) {
        const c0 = m2col(w.x1), r0 = m2row(w.y1)
        const c1 = m2col(w.x2), r1 = m2row(w.y2)
        const pts = bresenhamLine(c0, r0, c1, r1)
        for (const pt of pts) {
          // Use block character for walls — thick feel
          setCell(grid, pt.col, pt.row, '\u2588', C.wallChar, 5)
          // Shadow on right side
          setCell(grid, pt.col + 1, pt.row, '\u2591', '#333', 2)
        }
      }

      // Wall preview while drawing
      if (wallPreview && wallStart) {
        const c0 = m2col(wallStart.x), r0 = m2row(wallStart.y)
        const c1 = m2col(wallPreview.x), r1 = m2row(wallPreview.y)
        const pts = bresenhamLine(c0, r0, c1, r1)
        for (const pt of pts) {
          setCell(grid, pt.col, pt.row, '#', '#666', 3)
        }
      }

      // Layer 5: Handshake lines
      for (const h of handshakes) {
        const pA = persons.find(p => p.id === h.personA)
        const pB = persons.find(p => p.id === h.personB)
        if (!pA || !pB) continue

        let color, charOverride, priority
        if (h.active) {
          if (h.isFalsePositive) {
            // Pulsing red — vary between dim and bright
            const r = Math.round(140 + 99 * pulse)
            const g = Math.round(20 + 48 * pulse)
            const b = Math.round(20 + 48 * pulse)
            color = `rgb(${r},${g},${b})`
            charOverride = null
            priority = 4
          } else {
            color = C.lineReal
            charOverride = null
            priority = 4
          }
        } else if (h.pending) {
          color = C.linePending
          charOverride = '\u00B7'  // middle dot for pending
          priority = 3
        } else {
          continue
        }

        const c0 = m2col(pA.x), r0 = m2row(pA.y)
        const c1 = m2col(pB.x), r1 = m2row(pB.y)
        const pts = bresenhamLine(c0, r0, c1, r1)

        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i]
          // Skip cells near person centers
          if (Math.abs(pt.col - c0) <= 1 && Math.abs(pt.row - r0) <= 1) continue
          if (Math.abs(pt.col - c1) <= 1 && Math.abs(pt.row - r1) <= 1) continue
          // For pending, alternate chars for dashed look
          if (h.pending && (i % 3 === 0)) continue
          const ch = charOverride || pt.char
          setCell(grid, pt.col, pt.row, ch, color, priority)
        }

        // Distance label at midpoint
        const label = `${h.distance.toFixed(1)}m`
        const midCol = Math.round((c0 + c1) / 2) - Math.floor(label.length / 2)
        const midRow = Math.round((r0 + r1) / 2) - 1
        for (let i = 0; i < label.length; i++) {
          setCell(grid, midCol + i, midRow, label[i], '#888', 6)
        }
      }

      // Layer 6: Person glyphs
      for (const p of persons) {
        const col = m2col(p.x)
        const row = m2row(p.y)
        const isFlagged = handshakes.some(h =>
          h.active && (h.personA === p.id || h.personB === p.id)
        )
        const isFalseFlagged = handshakes.some(h =>
          h.active && h.isFalsePositive && (h.personA === p.id || h.personB === p.id)
        )

        const glowColor = isFalseFlagged ? C.glowRed : (isFlagged ? C.glowGreen : null)

        // Glow ring using luminance ramp chars (AcerolaFX-inspired)
        if (isFlagged) {
          const glowChars = ['@', '#', '*', ':', '.']
          const glowRadii = [0, 1.5, 2.2, 2.8, 3.4]
          for (let dr = -4; dr <= 4; dr++) {
            for (let dc = -5; dc <= 5; dc++) {
              if (dr === 0 && dc === 0) continue
              const d = Math.sqrt((dc * 0.7) ** 2 + dr ** 2) // adjust for aspect ratio
              let gi = -1
              for (let g = glowRadii.length - 1; g >= 1; g--) {
                if (d <= glowRadii[g] && d > glowRadii[g - 1]) { gi = g; break }
              }
              if (gi > 0) {
                const intensity = pulse * 0.4 + 0.6
                const gc = glowColor
                const alpha = (1 - gi / glowChars.length) * intensity
                // Approximate alpha by dimming the color
                const r = parseInt(gc.slice(1, 3), 16) || (gc === C.glowRed ? 239 : 34)
                const g = parseInt(gc.slice(3, 5), 16) || (gc === C.glowRed ? 68 : 197)
                const b = parseInt(gc.slice(5, 7), 16) || (gc === C.glowRed ? 68 : 94)
                const dimColor = `rgb(${Math.round(r * alpha)},${Math.round(g * alpha)},${Math.round(b * alpha)})`
                setCell(grid, col + dc, row + dr, glowChars[gi], dimColor, 3)
              }
            }
          }
        }

        // ASCII person art (3 rows x 3 cols)
        const personColor = isFlagged ? (isFalseFlagged ? C.personFlagged : '#a3e635') : C.person
        setCell(grid, col, row - 1, 'o', personColor, 8)
        setCell(grid, col - 1, row, '/', personColor, 8)
        setCell(grid, col, row, '\u2588', personColor, 8)  // █ body
        setCell(grid, col + 1, row, '\\', personColor, 8)
        setCell(grid, col - 1, row + 1, '/', personColor, 8)
        setCell(grid, col + 1, row + 1, '\\', personColor, 8)

        // Label below
        const lbl = p.label
        const lblCol = col - Math.floor(lbl.length / 2)
        const lblRow = row + 3
        for (let i = 0; i < lbl.length; i++) {
          setCell(grid, lblCol + i, lblRow, lbl[i], C.label, 7)
        }
      }

      // Layer 7: Mode flash overlay
      if (modeFlash) {
        const flashColor = mode === 'execution' ? '#2a1111' : '#111122'
        const textColor = mode === 'execution' ? C.execAccent : C.specAccent
        // Tint background chars
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            if (grid[row][col].priority <= 1) {
              const cell = grid[row][col]
              if (cell.char === ' ' && (col + row) % 3 === 0) {
                grid[row][col] = { char: '.', fg: flashColor, priority: 0 }
              }
            }
          }
        }
        // Flash message at bottom
        const msg = 'Material properties of Bluetooth reshape who is flagged'
        const msgCol = Math.floor(COLS / 2) - Math.floor(msg.length / 2)
        const msgRow = ROWS - 2
        for (let i = 0; i < msg.length; i++) {
          setCell(grid, msgCol + i, msgRow, msg[i], textColor, 10)
        }
      }

      // ── Render the ASCII grid to canvas ──────────────────────────────────
      ctx.font = `${FONT_SIZE}px 'Courier New', monospace`
      ctx.textBaseline = 'top'

      // Batch by color for performance
      const colorBatches = {}
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const cell = grid[row][col]
          if (cell.char === ' ') continue
          if (!colorBatches[cell.fg]) colorBatches[cell.fg] = []
          colorBatches[cell.fg].push({ col, row, char: cell.char })
        }
      }

      for (const [color, cells] of Object.entries(colorBatches)) {
        ctx.fillStyle = color
        for (const cell of cells) {
          ctx.fillText(cell.char, cell.col * CELL_W + 1, cell.row * CELL_H + 1)
        }
      }

      // Scanline effect (very subtle)
      for (let y = 0; y < CANVAS_H; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)'
        ctx.fillRect(0, y, CANVAS_W, 1)
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [persons, walls, roomLabels, handshakes, mode, modeFlash, wallPreview, wallStart])

  // ─── Mouse interaction (unchanged from original) ──────────────────────────
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

    for (const p of persons) {
      if (dist({ x: mx, y: my }, p) < PERSON_RADIUS / PIXELS_PER_METRE + 0.2) {
        setDragging(p.id)
        return
      }
    }

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

  const handleMouseUp = useCallback(() => { setDragging(null) }, [])

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

  const handleContextMenu = useCallback((e) => {
    if (scenario !== 'custom') return
    e.preventDefault()
    const pos = getCanvasPos(e)
    const mx = pos.x / PIXELS_PER_METRE
    const my = pos.y / PIXELS_PER_METRE

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
      if (d < closestDist) { closestDist = d; closestIdx = idx }
    })
    if (closestIdx >= 0) {
      setWalls(prev => prev.filter((_, i) => i !== closestIdx))
    }
  }, [scenario, walls, getCanvasPos])

  // ─── Render ───────────────────────────────────────────────────────────────
  const accentColor = mode === 'specification' ? C.specAccent : C.execAccent
  const accentDim = mode === 'specification' ? 'rgba(59,130,246,0.08)' : 'rgba(239,68,68,0.08)'

  // Sidebar styles (terminal aesthetic)
  const sectionStyle = {
    borderLeft: `1px solid #222`,
    paddingLeft: 10,
    marginBottom: 0,
  }
  const labelStyle = {
    fontSize: 9,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    marginBottom: 6,
    fontFamily: 'inherit',
  }
  const btnBase = {
    padding: '7px 10px',
    background: 'transparent',
    border: '1px solid #222',
    color: '#888',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    borderRadius: 0,
    textAlign: 'left',
    transition: 'all 0.15s',
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      background: '#0a0a0a',
      fontFamily: "'Courier New', 'Fira Code', monospace",
      color: '#e0e0e0',
    }}>
      {/* ASCII Header */}
      <header style={{
        padding: '12px 20px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div>
          <pre style={{
            fontSize: 10,
            color: accentColor,
            lineHeight: 1.1,
            margin: 0,
            opacity: 0.6,
          }}>{`
 _____                  _____              _   _
|_   _| _ __ _ __ ___  |_   _|___  __ _  _| |_| |_  ___ _ _
  | || '_/ _' / _/ -_)   | |/ _ \\/ _\` / -_)  _| ' \\/ -_) '_|
  |_||_| \\__,_\\__\\___|   |_|\\___/\\__, \\___|\\__|_||_\\___|_|
                                  |___/                         `.trimStart()}</pre>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4, letterSpacing: '0.2em' }}>
            BLUETOOTH HANDSHAKE SIMULATOR <span style={{ color: '#333' }}>// specification vs. execution</span>
          </div>
        </div>
        <div style={{ fontSize: 9, color: '#333', maxWidth: 280, textAlign: 'right', lineHeight: 1.5 }}>
          <span style={{ color: '#444' }}>Accompanying:</span><br />
          <em>Coding Health Risk onto the Body</em><br />
          Pappu Sarada Pranav, NUS 2026
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
        {/* Main canvas area */}
        <div style={{ flex: 1, minWidth: 600, padding: '12px 16px', position: 'relative' }}>
          {/* Stats overlay */}
          <div style={{
            position: 'absolute',
            top: 20,
            right: 24,
            background: 'rgba(10,10,10,0.92)',
            border: '1px solid #222',
            padding: '10px 14px',
            zIndex: 10,
            fontSize: 11,
            lineHeight: 1.9,
            minWidth: 210,
          }}>
            <div style={{ fontSize: 9, color: '#444', letterSpacing: '0.15em', marginBottom: 4 }}>
              ┌─ STATISTICS ─────────┐
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>│ Real Contacts:</span>
              <span style={{ color: C.lineReal, fontWeight: 600 }}>{realContacts} │</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>│ False Positives:</span>
              <span style={{ color: C.lineFalse, fontWeight: 600 }}>{falsePositives} │</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>│ Isolation Orders:</span>
              <span style={{ color: C.personFlagged, fontWeight: 600 }}>{isolationOrders} │</span>
            </div>
            <div style={{ fontSize: 9, color: '#444', letterSpacing: '0.15em', marginTop: 4 }}>
              └────────────────────┘
            </div>
            <div style={{
              marginTop: 6,
              fontSize: 9,
              color: '#444',
              fontStyle: 'italic',
              lineHeight: 1.5,
            }}>
              "The state cannot distinguish<br />
              real from false contacts. All<br />
              produce the same enforceable<br />
              consequence."
            </div>
          </div>

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              cursor: dragging ? 'grabbing' : (drawingWall ? 'crosshair' : 'default'),
              border: `1px solid ${accentColor}22`,
              display: 'block',
              imageRendering: 'pixelated',
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
              bottom: 20,
              left: 20,
              background: 'rgba(10,10,10,0.95)',
              border: `1px solid ${hoveredLine.isFalsePositive ? C.lineFalse : hoveredLine.active ? C.lineReal : '#333'}`,
              padding: '8px 12px',
              fontSize: 10,
              color: '#aaa',
              maxWidth: 400,
              lineHeight: 1.6,
              fontStyle: 'italic',
              zIndex: 10,
            }}>
              {'> '}{getTooltipText(hoveredLine)}
            </div>
          )}
        </div>

        {/* Right sidebar — terminal aesthetic */}
        <div style={{
          width: 300,
          borderLeft: '1px solid #1a1a1a',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
          fontSize: 11,
        }}>
          {/* Mode Toggle */}
          <div style={sectionStyle}>
            <div style={labelStyle}>{'>'} mode</div>
            <button
              onClick={toggleMode}
              style={{
                ...btnBase,
                width: '100%',
                background: accentDim,
                borderColor: `${accentColor}44`,
                color: accentColor,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2, letterSpacing: '0.1em' }}>
                [{mode === 'specification' ? 'SPEC' : 'EXEC'}]
                {mode === 'specification' ? ' SPECIFICATION' : ' EXECUTION'}
              </div>
              <div style={{ fontSize: 9, opacity: 0.6 }}>
                {mode === 'specification'
                  ? '// Ideal: Walls Block Signal'
                  : '// Real: Bluetooth Penetrates Walls'}
              </div>
            </button>
          </div>

          {/* Scenario Presets */}
          <div style={sectionStyle}>
            <div style={labelStyle}>{'>'} scenario</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(PRESETS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => loadPreset(key)}
                  style={{
                    ...btnBase,
                    background: scenario === key ? '#151515' : 'transparent',
                    borderColor: scenario === key ? '#333' : '#1a1a1a',
                    color: scenario === key ? '#e0e0e0' : '#555',
                  }}
                >
                  {scenario === key ? '> ' : '  '}{val.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom mode tools */}
          {scenario === 'custom' && (
            <div style={sectionStyle}>
              <div style={labelStyle}>{'>'} tools</div>
              <button
                onClick={() => { setDrawingWall(d => !d); setWallStart(null); setWallPreview(null) }}
                style={{
                  ...btnBase,
                  width: '100%',
                  background: drawingWall ? 'rgba(85,85,85,0.15)' : 'transparent',
                  borderColor: drawingWall ? '#555' : '#222',
                  color: drawingWall ? '#e0e0e0' : '#666',
                }}
              >
                {drawingWall ? '[x] Drawing Walls' : '[ ] Draw Wall'}
              </button>
              <div style={{ fontSize: 8, color: '#444', marginTop: 4, lineHeight: 1.5 }}>
                // click canvas to place persons (max 8)
                {drawingWall ? '\n// click two points for wall. right-click to remove.' : ''}
              </div>
            </div>
          )}

          {/* Time Control */}
          <div style={sectionStyle}>
            <div style={labelStyle}>{'>'} time: {timeElapsed} / 30 min</div>
            {/* ASCII progress bar */}
            <div style={{ fontSize: 10, color: '#444', marginBottom: 6, letterSpacing: 0 }}>
              [{Array.from({ length: 30 }, (_, i) => {
                const pos = i + 1
                if (pos <= timeElapsed) return <span key={i} style={{ color: timeElapsed >= TIME_THRESHOLD_MIN ? accentColor : '#555' }}>=</span>
                if (pos === 15) return <span key={i} style={{ color: '#666' }}>|</span>
                return <span key={i} style={{ color: '#1a1a1a' }}>-</span>
              })}]
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setTimeElapsed(t => Math.min(30, t + 15))}
                style={{ ...btnBase, flex: 1 }}
              >
                +15 min
              </button>
              <button
                onClick={() => setTimeElapsed(0)}
                style={btnBase}
              >
                reset
              </button>
            </div>
            <div style={{ fontSize: 8, color: '#444', marginTop: 4 }}>
              // 15 min proximity required for handshake
            </div>
          </div>

          {/* Handshake Table */}
          <div style={sectionStyle}>
            <div style={labelStyle}>{'>'} detected interactions</div>
            {handshakes.length === 0 ? (
              <div style={{ fontSize: 10, color: '#333', fontStyle: 'italic' }}>
                // no persons within bluetooth range
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {handshakes.map((h) => (
                  <div
                    key={`${h.personA}-${h.personB}`}
                    style={{
                      padding: '6px 8px',
                      background: h.active
                        ? (h.isFalsePositive ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)')
                        : 'transparent',
                      border: `1px solid ${h.active
                        ? (h.isFalsePositive ? '#ef444422' : '#22c55e22')
                        : '#1a1a1a'}`,
                      fontSize: 9,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#999' }}>
                        {h.labelA} {'<->'} {h.labelB}
                      </span>
                      <span style={{ color: '#555' }}>{h.distance.toFixed(1)}m</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 }}>
                      <span style={{
                        color: h.active
                          ? (h.isFalsePositive ? C.lineFalse : C.lineReal)
                          : (h.pending ? '#666' : '#333'),
                        fontWeight: h.active ? 600 : 400,
                      }}>
                        {h.active
                          ? (h.isFalsePositive ? '[!] FALSE POSITIVE' : '[+] CLOSE CONTACT')
                          : (h.pending ? '[.] awaiting threshold' : '[-] out of range')}
                      </span>
                      <span style={{
                        color: h.active ? C.personFlagged : '#333',
                        fontWeight: h.active ? 600 : 400,
                        fontSize: 8,
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
        padding: '8px 20px',
        borderTop: '1px solid #1a1a1a',
        fontSize: 9,
        color: '#333',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span>// drag persons to reposition. hover lines for annotations.</span>
        <span>NUS Coding Mortality Junior Seminar // {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
