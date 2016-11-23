module.exports = enumerateWaypointSets

// Given a 2d square array of items, return a list of all Rook polynomial solutions
// Each solution will be a list of items
// https://en.wikipedia.org/wiki/Rook_polynomial
function enumerateWaypointSets (grid) {
  const n = grid.length
  if (n === 1) {
    return [[grid[0][0]]];
  }

  const firstRow = grid[0];
  const otherRows = grid.slice(1);

  // For every item in the row, construct a subgrid with the item's row and column removed
  // Recursively enumerate the subgrid solutions, and prepend the item onto each solution
  const result = firstRow.map(function (item, index) {
    const otherRowsWithoutColumn = removeColumn({
      grid: otherRows,
      index
    })
    const subresults = enumerateWaypointSets(otherRowsWithoutColumn)
    return subresults.map(subresult => [item].concat(subresult))
  });

  // Finally, flatten the list of list of solutions
  return result.reduce(function(a, b) {
    return a.concat(b);
  }, []);
}

function removeColumn ({grid, index}) {
  return grid.map(function (row) {
     const result = row.slice()
     result.splice(index, 1)
     return result
   })
}

// ///////

grid = [
  [11, 12, 13, 14, 15],
  [21, 22, 23, 24, 25],
  [31, 32, 33, 34, 35],
  [41, 42, 43, 44, 45],
  [51, 52, 53, 54, 55],
];

console.log(enumerateWaypointSets(grid))
