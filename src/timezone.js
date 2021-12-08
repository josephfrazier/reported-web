function DisplayDstSwitchDates()
{
  var year = new Date().getYear();
  if (year < 1000)
    year += 1900;

  var firstSwitch = 0;
  var secondSwitch = 0;
  var lastOffset = 99;

  // Loop through every month of the current year
  for (let i = 0; i < 12; i++)
  {
    // Fetch the timezone value for the month
    var newDate = new Date(Date.UTC(year, i, 0, 0, 0, 0, 0));
    var tz = -1 * newDate.getTimezoneOffset() / 60;

    // Capture when a timzezone change occurs
    if (tz > lastOffset)
      firstSwitch = i-1;
    else if (tz < lastOffset)
      secondSwitch = i-1;

    lastOffset = tz;
  }

  // Go figure out date/time occurrences a minute before
  // a DST adjustment occurs
  var secondDstDate = FindDstSwitchDate(year, secondSwitch);
  var firstDstDate = FindDstSwitchDate(year, firstSwitch);

  return {firstDstDate, secondDstDate};
}

function FindDstSwitchDate(year, month)
{
  // Set the starting date
  var baseDate = new Date(Date.UTC(year, month, 0, 0, 0, 0, 0));
  var changeDay = 0;
  var changeMinute = -1;
  var baseOffset = -1 * baseDate.getTimezoneOffset() / 60;
  var dstDate;

  // Loop to find the exact day a timezone adjust occurs
  for (let day = 0; day < 50; day++)
  {
    var tmpDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    var tmpOffset = -1 * tmpDate.getTimezoneOffset() / 60;

    // Check if the timezone changed from one day to the next
    if (tmpOffset != baseOffset)
    {
      var minutes = 0;
      changeDay = day;

      // Back-up one day and grap the offset
      tmpDate = new Date(Date.UTC(year, month, day-1, 0, 0, 0, 0));
      tmpOffset = -1 * tmpDate.getTimezoneOffset() / 60;

      // Count the minutes until a timezone change occurs
      while (changeMinute == -1)
      {
        tmpDate = new Date(Date.UTC(year, month, day-1, 0, minutes, 0, 0));
        tmpOffset = -1 * tmpDate.getTimezoneOffset() / 60;

        // Determine the exact minute a timezone change
        // occurs
        if (tmpOffset != baseOffset)
        {
          // Back-up a minute to get the date/time just
          // before a timezone change occurs
          tmpOffset = new Date(Date.UTC(year, month,
            day-1, 0, minutes-1, 0, 0));
          changeMinute = minutes;
          break;
        }
        else
          minutes++;
      }

      // Add a month (for display) since JavaScript counts
      // months from 0 to 11
      dstDate = tmpOffset.getMonth() + 1;

      // Pad the month as needed
      if (dstDate < 10) dstDate = "0" + dstDate;

      // Add the day and year
      dstDate += '/' + tmpOffset.getDate() + '/' + year + ' ';

      // Capture the time stamp
      tmpDate = new Date(Date.UTC(year, month,
        day-1, 0, minutes-1, 0, 0));
      dstDate += tmpDate.toTimeString().split(' ')[0];
      return dstDate;
    }
  }
}

function isDst(date) {
  const result = DisplayDstSwitchDates()
  // console.log(result)

  const { firstDstDate, secondDstDate } = result
  const from = new Date(firstDstDate)
  const to = new Date(secondDstDate)
  const now = new Date();
  const isDst = from.getTime() < now.getTime() && now.getTime() < to.getTime()
  // console.log({isDst})

  return isDst;
}

export function getNycTimezoneOffset(date) {
  return isDst(date) ? -240 : -300
}
