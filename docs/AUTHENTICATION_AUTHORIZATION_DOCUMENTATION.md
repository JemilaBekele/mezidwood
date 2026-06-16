# Authentication & Authorization System Documentation

## Table of Contents
1. [Overview](#overview)
2. [Frontend Authentication Flow](#frontend-authentication-flow)
3. [Backend Authentication System](#backend-authentication-system)
4. [Token Management](#token-management)
5. [Authorization & Permissions](#authorization--permissions)
6. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
7. [Security Features](#security-features)
8. [API Endpoints](#api-endpoints)
9. [Default Credentials](#default-credentials)
10. [Integration Examples](#integration-examples)

---

## Overview

This Rosewood curtain
 management system implements a comprehensive authentication and authorization system using **NextAuth.js** on the frontend and **JWT-based authentication** with **Role-Based Access Control (RBAC)** on the backend.

### Key Technologies
- **Frontend**: NextAuth.js, Zustand for state management, TypeScript
- **Backend**: Node.js, Express, JWT, Prisma ORM, MySQL
- **Authentication**: JWT tokens (Access + Refresh)
- **Authorization**: Role-based permissions system
- **Security**: Rate limiting, password hashing, CORS protection

---

## Frontend Authentication Flow

### 1. Authentication Configuration (`auth.config.ts`)

```typescript
// Uses CredentialsProvider for email/password authentication
const authConfig: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: 'email', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        // Calls backend /login endpoint
        const response = await api.post('/login', {
          email: credentials?.email,
          password: credentials?.password
        });
        
        // Returns user object with permissions
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.role?.permissions || []
        };
      }
    })
  ],
  // JWT strategy with 24-hour session
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 }
};
```

### 2. Permission State Management (`stores/auth.store.ts`)

**Zustand store** manages permissions with SSR/CSR compatibility:

```typescript
interface PermissionState {
  permissions: string[];
  _hasHydrated: boolean;
  _isInitialized: boolean;
  
  // Permission checking methods
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
}
```

**Features:**
- **Persistent storage** in localStorage
- **SSR-safe** with hydration tracking
- **Permission validation** methods
- **Automatic cleanup** on logout

### 3. Login Component (`features/auth/sign.tsx`)

**Login Process:**
1. **Clears all stored data** (localStorage, sessionStorage, IndexedDB)
2. **Calls NextAuth signIn()** with credentials
3. **Handles response** and redirects to dashboard
4. **Error handling** with user feedback

**Security Measures:**
- Clears previous session data before login
- Hard navigation to prevent React state issues
- Comprehensive data cleanup

### 4. API Integration (`service/api.ts`)

**Axios interceptor** automatically adds JWT tokens:

```typescript
api.interceptors.request.use(async (config) => {
  const session = await getServerSession(authConfig);
  const accessToken = session?.user?.accessToken;
  
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});
```

---

## Backend Authentication System

### 1. Authentication Controllers (`controllers/auth.controller.js`)

**Multiple Login Endpoints:**
- **`/login`** - General login for all users
- **`/api/login/Sales/only`** - Sales personnel only
- **`/api/login/Store/only`** - Store personnel only

```javascript
const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.login(email, password, req.connection.remoteAddress);
  const tokens = await tokenService.generateAuthTokens(user.id);
  res.status(200).send({ user, tokens });
};
```

### 2. Authentication Service (`services/auth.service.js`)

**Login Process:**
1. **Rate limiting** with multiple strategies
2. **User lookup** with role and permissions
3. **Password verification** using bcrypt
4. **Status validation** (Active/Inactive/Suspended)
5. **Permission formatting** for frontend
6. **Last login update**

**Rate Limiting Strategy:**
- **IP-based**: 100 attempts per day
- **Email+IP**: 10 attempts per 10 minutes
- **Email only**: 5 attempts per day

### 3. Authentication Middleware (`middlewares/auth.js`)

**JWT Verification:**
```javascript
const auth = async (req, res, next) => {
  return new Promise((resolve, reject) => {
    passport.authenticate('jwt', { session: false }, 
      verifyCallBack(req, resolve, reject)
    )(req, res, next);
  });
};
```

**Features:**
- **Passport.js JWT strategy**
- **Detailed logging** for debugging
- **User attachment** to request object
- **Error handling** with proper HTTP status

---

## Token Management

### 1. JWT Token Service (`services/token.service.js`)

**Token Generation:**
```javascript
const generateAuthTokens = async (userId) => {
  // Access token: 60 minutes
  const accessToken = generateToken(userId, 
    dayjs().add(config.jwt.accessExpirationMinutes, 'minutes'), 
    tokenTypes.ACCESS);
  
  // Refresh token: 2 days
  const refreshToken = generateToken(userId, 
    dayjs().add(config.jwt.refreshExpirationDays, 'days'), 
    tokenTypes.REFRESH);
    
  return { access: { token: accessToken }, refresh: { token: refreshToken } };
};
```

**Token Structure:**
```javascript
{
  sub: userId,           // Subject (user ID)
  iat: issuedAt,        // Issued at timestamp
  exp: expiration,       // Expiration timestamp
  type: 'access'/'refresh' // Token type
}
```

### 2. Token Configuration

**Environment Variables:**
```env
JWT_SECRET=superSecretJwtKey123
JWT_ACCESS_EXPIRATION_MINUTES=3600  # 1 hour
JWT_REFRESH_EXPIRATION_DAYS=2        # 2 days
```

**Security Features:**
- **Stateless tokens** (no database storage)
- **Type verification** (access vs refresh)
- **Automatic expiration** handling
- **Secure secret** management

---

## Authorization & Permissions

### 1. Permission Middleware (`middlewares/permission.middleware.js`)

**Permission Checking:**
```javascript
const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    // 1. Verify user exists
    if (!user) {
      throw new ApiError(UNAUTHORIZED, 'Authentication required');
    }
    
    // 2. Fetch user with permissions
    const userWithPermissions = await prisma.user.findUnique({
      include: {
        role: { include: { permissions: { include: { permission: true } } }
      }
    });
    
    // 3. Check specific permission
    const hasPermission = userWithPermissions.role.permissions.some(
      rp => rp.permission.name === requiredPermission
    );
    
    if (!hasPermission) {
      throw new ApiError(FORBIDDEN, `Required: ${requiredPermission}`);
    }
    
    next();
  };
};
```

### 2. Frontend Permission Guards (`components/PermissionGuard.tsx`)

**React Component for Route Protection:**
```typescript
interface PermissionGuardProps {
  children: ReactNode;
  requiredPermission?: string;
  requiredPermissions?: string[];
  mode?: 'all' | 'any';  // AND/OR logic
  hideInsteadOfRedirect?: boolean;
}

// Usage example
<PermissionGuard requiredPermission="VIEW_ALL_PRODUCTS">
  <ProductList />
</PermissionGuard>
```

### 3. Permission Checking Hooks (`stores/checker.ts`)

**Utility Functions:**
```typescript
// Check single permission
hasPermission(permission: string): boolean

// Check if user has ANY of the permissions
hasAnyPermission(permissions: string[]): boolean

// Check if user has ALL of the permissions
hasAllPermissions(permissions: string[]): boolean
```

---

## Role-Based Access Control (RBAC)

### 1. Database Schema

**User Model:**
```prisma
model User {
  id       String   @id @default(uuid())
  email    String   @unique
  password String
  name     String
  status   Status   @default(Active)
  admin    Boolean  @default(false)
  
  roleId   String
  role     Role     @relation(fields: [roleId], references: [id])
  
  // Multi-tenancy support
  branchId String?
  shops    Shop[]
  stores   Store[]
}
```

**Role & Permission Models:**
```prisma
model Role {
  id          String @id @default(uuid())
  name        String @unique
  description String?
  permissions RolePermission[]
}

model Permission {
  id          String @id @default(uuid())
  name        String @unique
  description String?
}
```

### 2. Permission Constants (`middlewares/permissions.constants.js`)

**Comprehensive Permission Set:**
- **User Management**: CREATE_USER, VIEW_ALL_USERS, UPDATE_USER, DELETE_USER
- **Product Management**: CREATE_PRODUCT, VIEW_ALL_PRODUCTS, UPDATE_PRODUCT
- **Sales**: CREATE_SELL, VIEW_ALL_SELLS, UPDATE_SELL_STATUS
- **Inventory**: CREATE_TRANSFER, APPROVE_STOCK_CORRECTION
- **Reports**: VIEW_TOTAL_SOLD, VIEW_SALES_RANK, VIEW_MAIN_DASHBOARD
- **System**: ROLE_MANAGEMENT, PERMISSION_MANAGEMENT

**Total: 60+ permissions** across 8 categories

### 3. Role-Based Login Restrictions

**Store Login (`/api/login/Store/only`):**
- Allows **Admin** users
- Allows users with **"store"** in role name

**Sales Login (`/api/login/Sales/only`):**
- Allows **Admin** users  
- Allows users with **"sales"** in role name

---

## Security Features

### 1. Password Security
- **Bcrypt hashing** with salt rounds = 8
- **Password strength** requirements
- **Secure password reset** functionality

### 2. Rate Limiting
```javascript
// Multiple rate limiting strategies
const rateLimiterOptions = {
  blockDuration: 60 * 60 * 24,  // 1 day block
  maxAttemptsPerDay: 100,
  maxAttemptsByIpUsername: 10,
  maxAttemptsPerEmail: 5
};
```

### 3. Token Security
- **JWT signature verification**
- **Token expiration** handling
- **Type-based token validation**
- **No token storage** in database (stateless)

### 4. CORS & Headers
```javascript
cspOptions: {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'", 'fonts.gstatic.com']
  }
}
```

---

## API Endpoints

### Authentication Endpoints
```
POST /api/login              # General login
POST /api/login/Sales/only   # Sales-only login  
POST /api/login/Store/only   # Store-only login
POST /api/register           # User registration
PUT  /api/users/change-password  # Password change
PUT  /api/user/reset-password/:userId  # Admin password reset
```

### Protected Endpoints (Examples)
```
GET  /api/users              # Requires auth
GET  /api/products          # Requires auth + VIEW_ALL_PRODUCTS
POST /api/products          # Requires auth + CREATE_PRODUCT
PUT  /api/users/:userId     # Requires auth + UPDATE_USER
```

---

## Default Credentials

### System Administrator
- **Email**: `admbfn@example.com`
- **Password**: `Admin@1234`
- **Role**: Admin
- **Permissions**: All permissions (60+)
- **Access**: Full system access

### Environment Override
```javascript
// Can be overridden via environment variables
email: process.env.ADMIN_EMAIL || 'admbfn@example.com'
password: process.env.ADMIN_PASSWORD || 'Admin@1234'
```

---

## Integration Examples

### 1. Frontend Permission Check
```typescript
// Using hooks
const hasPermission = usePermissionStore(state => state.hasPermission);
if (hasPermission('VIEW_ALL_PRODUCTS')) {
  // Show products
}

// Using PermissionGuard
<PermissionGuard 
  requiredPermissions={['CREATE_PRODUCT', 'UPDATE_PRODUCT']} 
  mode='all'
>
  <ProductForm />
</PermissionGuard>
```

### 2. Backend Route Protection
```javascript
// Single permission
router.get('/api/products', 
  auth, 
  checkPermission('VIEW_ALL_PRODUCTS'), 
  productController.getAllProducts
);

// Multiple permissions
router.post('/api/users', 
  auth, 
  checkPermission('CREATE_USER'), 
  userController.createUser
);
```

### 3. API Request with Authentication
```typescript
// Automatic token injection via interceptor
const response = await api.get('/api/products');

// Manual token handling
const session = await getSession();
const headers = {
  'Authorization': `Bearer ${session.user.accessToken}`
};
```

---

## System Initialization

### Automatic Setup (`middlewares/initialSetup.js`)

**On Application Start:**
1. **Creates Admin role** if not exists
2. **Creates all permissions** (60+ permissions)
3. **Assigns all permissions** to Admin role
4. **Creates admin user** with default credentials
5. **Sets up system permissions** and relationships

**Initialization Flow:**
```javascript
static async initialize() {
  const adminRole = await SystemInitializer.setupAdminRole();
  await SystemInitializer.setupDefaultPermissions();
  await roleService.assignPermissions(adminRole.id, allPermissionIds);
  await SystemInitializer.setupAdminUser(adminRole);
}
```

---

## Summary

This authentication and authorization system provides:

✅ **Secure JWT-based authentication** with refresh tokens  
✅ **Comprehensive RBAC** with 60+ granular permissions  
✅ **Multi-tenant support** with branch/shop/store assignments  
✅ **Role-based login restrictions** for different user types  
✅ **Frontend permission guards** with React integration  
✅ **Rate limiting** and security protections  
✅ **Automatic system initialization** with default admin  
✅ **State management** with SSR compatibility  
✅ **Detailed logging** and debugging capabilities  

The system is production-ready with enterprise-grade security features and flexible permission management suitable for complex inventory management workflows.
