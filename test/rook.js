const test = require('tape')
const enumerateWaypointSets = require('../src/rook.js')

test('empty grid', function (t) {
  t.deepEqual(enumerateWaypointSets([[]]), [])
  t.end()
})

test('single cell', function (t) {
  t.deepEqual(enumerateWaypointSets([[1]]), [[1]])
  t.end()
})

test('2x2', function (t) {
  const grid = [
    [11, 12],
    [21, 22]
  ]

  const expected = [[11, 22], [12, 21]]

  t.deepEqual(enumerateWaypointSets(grid), expected)
  t.end()
})
