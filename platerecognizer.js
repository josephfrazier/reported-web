// adapted from https://docs.platerecognizer.com/?javascript#read-number-plates-from-an-image

const fetch = require("node-fetch");
const FormData = require("form-data");
const fs = require("fs");

require('dotenv').config();

const { PLATERECOGNIZER_TOKEN } = process.env;

let image_path = __dirname + "/PXL_20220617_203454473_50percent.jpg";
console.log(image_path)
let body = new FormData();

body.append("upload", fs.createReadStream(image_path));
// Or body.append('upload', base64Image);

// body.append("regions", "us-ca"); // Change to your country
// body.append("regions", "us-ny"); // Change to your country
body.append("regions", "us"); // Change to your country

fetch("https://api.platerecognizer.com/v1/plate-reader/", {
  method: "POST",
  headers: {
    Authorization: `Token ${PLATERECOGNIZER_TOKEN}`,
  },
  body: body,
})
  .then((res) => res.json())
  .then((json) => console.log(JSON.stringify(json, null, 2)))
  .catch((err) => {
    console.log(err);
  });
