module.exports = enumerateWaypointSets

// Given a 2d square array of items, return a list of all Rook polynomial solutions
// Each solution will be a list of items
// https://en.wikipedia.org/wiki/Rook_polynomial
function enumerateWaypointSets (grid) {
  const n = grid.length
  if (n === 1) {
    return [[grid[0][0]]]
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

// ///////

// https://farm3.static.flickr.com/2778/4134507221_d0c9ec1b7c_o.jpg
module.exports.grid = [
  ['221-225 8th Ave, 10011', '907 8th Ave', '289 Columbus Ave', '25 University Pl'],
  ['512 2nd Ave', '452 W 43rd St.', '1407 Lexington Ave', '316 Greenwich St'],
  ['311 E 23rd St', '580 9th Ave', '2704 Broadway', '5 St. James Pl'],
  ['10 Union Sq. East', '225 W. 57th St', '609 Columbus Ave', '2217 7th Ave']
]
