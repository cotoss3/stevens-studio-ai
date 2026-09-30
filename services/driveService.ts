
/**
 * Service to handle real Google Drive uploads and User profile.
 */
export class DriveService {
  private readonly FOLDER_ID = '1DplW1WvQ3bdBKPfOFgcRPpwXEHUR-YUi';
  private accessToken: string | null = null;

  /**
   * Requests an access token from Google using the Identity Services popup.
   */
  async getAccessToken(clientId: string): Promise<string> {
    if (this.accessToken) return this.accessToken;

    return new Promise((resolve, reject) => {
      try {
        if (!window.google) {
          reject(new Error("Google SDK no cargado. Revisa tu conexión a internet."));
          return;
        }

        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(response.error_description || "Error de autenticación"));
              return;
            }
            this.accessToken = response.access_token;
            resolve(response.access_token);
          },
        });
        client.requestAccessToken();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Fetches the user profile info from Google.
   */
  async getUserProfile(token: string) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("No se pudo obtener el perfil de usuario");
    return await response.json();
  }

  /**
   * Uploads a base64 image to the specified Google Drive folder.
   */
  async uploadImage(base64Data: string, fileName: string, token: string): Promise<any> {
    try {
      const base64Content = base64Data.split(',')[1];
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });

      const metadata = {
        name: fileName,
        parents: [this.FOLDER_ID],
        description: 'Subido automáticamente vía UPC Snap & Save - Professional Studio AI',
        mimeType: 'image/jpeg',
      };

      const formData = new FormData();
      formData.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' })
      );
      formData.append('file', blob);

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          this.accessToken = null;
          throw new Error("Sesión expirada. Por favor, intenta de nuevo.");
        }
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Error al subir a Drive');
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(error.message || "Error de red al conectar con Drive");
    }
  }

  logout() {
    this.accessToken = null;
  }
}

export const driveService = new DriveService();

declare global {
  interface Window {
    google: any;
  }
}
