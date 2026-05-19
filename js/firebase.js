import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// Importando serviços essenciais
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAY_qGll6YJKA6ErYIOd5XIVblrlq8vynM", 
    authDomain: "banca-adair-e-pedrina.firebaseapp.com",
    projectId: "banca-adair-e-pedrina",
    storageBucket: "banca-adair-e-pedrina.firebasestorage.app"
};

const app = initializeApp(firebaseConfig);

// Configuração robusta com Cache Offline (Funciona sem 4G temporariamente)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

const auth = getAuth(app);
const storage = getStorage(app);

// Exportando os módulos para serem usados pelo app.js e admin.js
export { 
    db, auth, storage,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut,
    ref, uploadBytes, getDownloadURL
};
