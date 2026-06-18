import { initializeApp } from "firebase/app";
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously } from "firebase/auth";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    query, orderBy, limit, writeBatch, where, updateDoc
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// A API Key continua protegida pelas variáveis de ambiente do Vite
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY, 
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
    query, orderBy, limit, writeBatch, where, updateDoc,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously,
    ref, uploadBytes, getDownloadURL
};
