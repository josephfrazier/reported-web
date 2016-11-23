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
  ['221-225 8th Ave, 10011', '907 8th Ave, NYC', '289 Columbus Ave, NYC', '25 University Pl, NYC'],
  ['512 2nd Ave, NYC', '452 W 43rd St., NYC', '1407 Lexington Ave, NYC', '316 Greenwich St, NYC'],
  ['311 E 23rd St, NYC', '580 9th Ave, NYC', '2704 Broadway, NYC', '5 St. James Pl, NYC'],
  ['10 Union Sq. East, NYC', '225 W. 57th St, NYC', '609 Columbus Ave, NYC', '2217 7th Ave, NYC']
]
