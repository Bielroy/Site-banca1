// Firebase Storage (envio de fotos pelo painel, quando não há ImgBB). Separado de js/firebase.js
// para não pesar na loja: o cliente que abre a vitrine não baixa esta parte.
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { app } from './firebase.js';

const storage = getStorage(app);
export { storage, ref, uploadBytes, getDownloadURL };
