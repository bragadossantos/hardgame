import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser, UserRole } from '@hardgame/shared';

const DEFAULT_DEV_SECRET = 'hardgame-segredo-local-mudar-em-producao';

export function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? DEFAULT_DEV_SECRET;
  if (process.env.NODE_ENV === 'production' && secret === DEFAULT_DEV_SECRET) {
    throw new Error(
      'Segurança: JWT_SECRET não pode usar o valor por defeito em produção. Define um segredo único no .env.'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signUserToken(user: AuthUser): Promise<string> {
  const secretKey = getJwtSecretKey();
  return new SignJWT({
    sub: String(user.id),
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    institution: user.institution,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secretKey);
}

export async function verifyUserToken(token: string): Promise<AuthUser | null> {
  try {
    const secretKey = getJwtSecretKey();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || typeof payload.username !== 'string') {
      return null;
    }
    const role = payload.role === 'admin' ? 'admin' : 'player';
    return {
      id,
      username: payload.username,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : payload.username,
      role,
      institution: typeof payload.institution === 'string' ? payload.institution : null,
    };
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'Sessão não iniciada. Token em falta.' });
      return;
    }
    const user = await verifyUserToken(token);
    if (!user) {
      res.status(401).json({ error: 'Token inválido ou expirado.' });
      return;
    }
    req.user = user;
    next();
  };
}

export function requireRole(role: UserRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'Sessão não iniciada. Token em falta.' });
      return;
    }
    const user = await verifyUserToken(token);
    if (!user) {
      res.status(401).json({ error: 'Token inválido ou expirado.' });
      return;
    }
    if (user.role !== role) {
      res.status(403).json({ error: 'Acesso negado para o teu papel de utilizador.' });
      return;
    }
    req.user = user;
    next();
  };
}

