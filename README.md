# 🏨 Multi-Tenant Hotel Management Backend API

A robust, enterprise-grade, multi-tenant REST API built with **Node.js**, **Express**, **TypeScript**, and **MongoDB**. Designed for hotel chains, independent boutique hotels, and SaaS platforms with role-based access control (RBAC), subscription management, and complete operational workflows.

---

## 🌟 Key Features

- **Multi-Tenant Architecture**: Strict data isolation per hotel/tenant with tenant IDs.
- **Role-Based Access Control (RBAC)**:
  - `SUPER_ADMIN`: SaaS platform control, approvals, subscription plans, system audit logs.
  - `HOTEL_ADMIN`: Hotel profile, room types, rooms, staff management, analytics & daily collection reports.
  - `RECEPTIONIST`: Real-time room availability, check-in/check-out wizard, folio & payments, cash handover.
- **Authentication & Security**:
  - JWT (JSON Web Tokens) with secure HttpOnly cookie & Bearer token support.
  - Password hashing with Bcrypt.
  - Password reset workflows with secure token expiration & transactional emails.
- **Email Notifications**: Nodemailer integration for welcome emails, password resets, and booking confirmations.
- **Audit Logging**: Comprehensive system activity tracking for compliance and security.
- **Postman Integration**: Live auto-sync collection for easy API exploration and testing.

---

## 🛠️ Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/) (v18+)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/) ODM
- **Development Tooling**: `tsx`, `nodemon`, `rimraf`
- **Email**: [Nodemailer](https://nodemailer.com/)

---

## 📁 Project Structure

```text
backend/
├── src/
│   ├── config/             # Database connection & configurations
│   ├── controllers/        # Request handlers per module
│   │   ├── authController.ts
│   │   ├── hotelAdminController.ts
│   │   ├── hotelController.ts
│   │   ├── receptionistController.ts
│   │   ├── subscriptionPlanController.ts
│   │   └── superAdminController.ts
│   ├── middleware/         # Auth & RBAC middlewares
│   │   └── authMiddleware.ts
│   ├── models/             # Mongoose schemas & data models
│   │   ├── AuditLog.ts
│   │   ├── Booking.ts
│   │   ├── BookingCharge.ts
│   │   ├── CashHandover.ts
│   │   ├── Guest.ts
│   │   ├── Hotel.ts
│   │   ├── PasswordResetToken.ts
│   │   ├── Payment.ts
│   │   ├── Room.ts
│   │   ├── RoomType.ts
│   │   ├── SubscriptionPlan.ts
│   │   └── User.ts
│   ├── routes/             # Express API route declarations
│   ├── utils/              # Email templates, audit logger, helpers
│   ├── seed.ts             # Initial demo database seeder
│   └── server.ts           # Main application entry point
├── .env.example            # Sample environment variables
├── nodemon.json            # Nodemon config
├── package.json            # Dependencies & scripts
├── postman_collection.json # Ready-to-import Postman collection
└── tsconfig.json           # TypeScript configuration
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0 or higher
- **MongoDB**: Running locally or a remote MongoDB Atlas URI

### 2. Installation

Clone the repository and install dependencies:
```bash
git clone https://github.com/paneliyatechnology-debug/Hotel_management_backend.git
cd Hotel_management_backend
npm install
```

### 3. Environment Configuration

Copy the sample environment file and update the values:
```bash
cp .env.example .env
```

Configure the following variables in `.env`:
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/hotel_management
JWT_SECRET=your_secure_jwt_secret_key

# Email Settings (Optional / Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_app_password
FROM_NAME="The Grand Royale Hotel"
FROM_EMAIL=your_email@gmail.com

# Postman Live Auto-Sync (Optional)
POSTMAN_API_KEY=your_postman_api_key
POSTMAN_COLLECTION_UID=your_postman_collection_uid
```

### 4. Database Seeding

Populate the database with initial plans and default admin credentials:
```bash
npm run seed
```

### 5. Running the Application

- **Development Mode** (with hot reload):
  ```bash
  npm run dev
  ```
- **Build TypeScript**:
  ```bash
  npm run build
  ```
- **Production Start**:
  ```bash
  npm start
  ```

---

## 📡 API Endpoints Overview

| Module | Base Route | Description |
| :--- | :--- | :--- |
| **Auth** | `/api/v1/auth` | User login, logout, current user profile, password reset flow |
| **Hotels (Public)** | `/api/v1/hotels` | Public hotel registrations & public listings |
| **Subscription Plans**| `/api/v1/subscription-plans` | Subscription tier listings and pricing |
| **Super Admin** | `/api/v1/super-admin` | Platform metrics, pending hotel approvals, audit logs |
| **Hotel Admin** | `/api/v1/admin` | Hotel details, rooms, room types, staff, daily collections |
| **Receptionist** | `/api/v1/receptionist` | Front-desk operations, room availability, check-in/out, folios |

---

## 📜 License

This project is proprietary and confidential. Developed by Paneliya Technology.
