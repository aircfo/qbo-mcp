declare module "intuit-oauth" {
  interface IntuitTokenData {
    access_token: string;
    refresh_token: string;
    token_type?: string;
    expires_in?: number;
    x_refresh_token_expires_in?: number;
    realmId?: string;
  }

  interface AuthResponse {
    token: IntuitTokenData;
    getToken(): IntuitTokenData;
  }

  export default class OAuthClient {
    constructor(options: {
      clientId: string;
      clientSecret: string;
      environment: string;
      redirectUri: string;
    });

    static scopes: {
      Accounting: string;
      Payment: string;
      Payroll: string;
      OpenId: string;
      Profile: string;
      Email: string;
      Phone: string;
      Address: string;
    };

    // Returns the absolute authorization URL as a string.
    authorizeUri(options: { scope: string[]; state: string }): string;

    // Accepts the full callback URL (with code/realmId/state query params).
    createToken(url: string): Promise<AuthResponse>;
    refreshUsingToken(refreshToken: string): Promise<AuthResponse>;
    revoke(options: { token: string }): Promise<unknown>;
  }
}
