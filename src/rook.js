module.exports = enumerateWaypointSets

// Given a 2d square array of items, return a list of all Rook polynomial solutions
// Each solution will be a list of items
// https://en.wikipedia.org/wiki/Rook_polynomial
function enumerateWaypointSets (grid) {
  const n = grid.length
  if (n === 0) {
    return [[]]
  }

  const firstRow = grid[0]
  const otherRows = grid.slice(1)

  // For every item in the row, construct a subgrid with the item's row and column removed
  // Recursively enumerate the subgrid solutions, and prepend the item onto each solution
  const result = firstRow.map(function (item, index) {
    const otherRowsWithoutColumn = removeColumn({
      grid: otherRows,
      index
    })
    const subresults = enumerateWaypointSets(otherRowsWithoutColumn)
    return subresults.map(subresult => [item].concat(subresult))
  })

  // Finally, flatten the list of list of solutions
  return result.reduce(function (a, b) {
    return a.concat(b)
  }, [])
}

function removeColumn ({grid, index}) {
  return grid.map(function (row) {
    const result = row.slice()
    result.splice(index, 1)
    return result
  })
}
