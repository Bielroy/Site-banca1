import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    query, orderBy, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAY_qGll6YJKA6ErYIOd5XIVblrlq8vynM", 
    authDomain: "banca-adair-e-pedrina.firebaseapp.com",
    projectId: "banca-adair-e-pedrina",
    storageBucket: "banca-adair-e-pedrina.firebasestorage.app"
};

const app = initializeApp(firebaseConfig);

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

const auth = getAuth(app);
const storage = getStorage(app);

export { 
    db, auth, storage,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    query, orderBy, limit, writeBatch,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously,
    ref, uploadBytes, getDownloadURL
};
