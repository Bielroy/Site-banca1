import { initializeApp } from "firebase/app";
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously } from "firebase/auth";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    memoryLocalCache,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    query, orderBy, limit, writeBatch, where, updateDoc, deleteField,
    terminate, clearIndexedDbPersistence
} from "firebase/firestore";

// A API Key continua protegida pelas variáveis de ambiente do Vite
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY, 
    authDomain: "banca-adair-e-pedrina.firebaseapp.com",
    projectId: "banca-adair-e-pedrina",
    storageBucket: "banca-adair-e-pedrina.firebasestorage.app"
};

const app = initializeApp(firebaseConfig);

// IPHONE E IPAD: o banco NÃO guarda cópia no aparelho; lê sempre da internet.
// No iPhone a cópia guardada dá dois problemas conhecidos: (1) depois de o site ficar um tempo em
// segundo plano, o navegador derruba a ligação com o armazenamento e a tela para de receber novidades
// (preço, produto esgotado, horários de entrega) até recarregar; (2) a tela abria com a configuração
// antiga da loja. Foi assim que um cliente ficou sem a lista de horários. Nos outros aparelhos nada muda.
const ehApple = typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent || '') || (/macintosh/i.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1));
const db = initializeFirestore(app, {
    localCache: ehApple ? memoryLocalCache() : persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

const auth = getAuth(app);

// O armazenamento de arquivos (Firebase Storage) fica em js/firebase-arquivos.js: só o painel usa,
// e aqui ele ia junto para todo cliente que abre a loja.
export { 
    app, db, auth,
    collection, getDocs, doc, setDoc, deleteDoc, getDoc, onSnapshot, addDoc,
    query, orderBy, limit, writeBatch, where, updateDoc, deleteField,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously,
    terminate, clearIndexedDbPersistence
};
