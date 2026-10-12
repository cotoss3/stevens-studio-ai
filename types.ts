export enum AppStep {
  LOGIN = 'LOGIN',
  SCAN_UPC = 'SCAN_UPC',
  PRODUCT_PHOTO = 'PRODUCT_PHOTO',
  RECORD_AUDIO = 'RECORD_AUDIO',
  REVIEW = 'REVIEW',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface AppState {
  step: AppStep;
  upcCode: string | null;
  upcImage: string | null;
  productImage: string | null;
  audioBase64: string | null;
  transcription: string | null;
  productTitle: string | null;
  productDescription: string | null;
  isProcessing: boolean;
  error: string | null;
  user: User | null;
}

export interface Product {
  $id: string;
  upc: string;
  imageUrl: string;
  fileId: string;
  userName?: string;
  createdAt?: string;
  title?: string | null;
  description?: string | null;
  transcription?: string | null;
}
