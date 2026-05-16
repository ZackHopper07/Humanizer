const firebaseConfig = {
  apiKey: "AIzaSyDebJDW8Z4Vp1EAqfkZLtyX2KQPOVG3uR4",
  authDomain: "ai-humanizer-b1377.firebaseapp.com",
  projectId: "ai-humanizer-b1377",
  storageBucket: "ai-humanizer-b1377.appspot.com",
  messagingSenderId: "1075332105902",
  appId: "1:1075332105902:web:dbc4739ba132742e8ecf3f",
  measurementId: "G-L72MKFZBT7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();