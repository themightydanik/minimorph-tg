// firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

  const firebaseConfig = {
    apiKey: "AIzaSyDJcoFIMzVKy0YFlwfeZPmuYwwyS8VqJAA",
    authDomain: "minimorph-b52f7.firebaseapp.com",
    projectId: "minimorph-b52f7",
    storageBucket: "minimorph-b52f7.firebasestorage.app",
    messagingSenderId: "346164042237",
    appId: "1:346164042237:web:fcff2f4e6af39baf9a2194",
    measurementId: "G-0TFC304JVN"
  };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
