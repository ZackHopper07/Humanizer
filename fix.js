const fs = require('fs');
let c = fs.readFileSync('./server.js', 'utf8');

const oldCode = const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};;

const newCode = const serviceAccount = require("./ai-humanizer-b1377-firebase-adminsdk-fbsvc-0dc018ac9f.json");;

c = c.replace(oldCode, newCode);
fs.writeFileSync('./server.js', c);
console.log('DONE');
