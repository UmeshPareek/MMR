# MMR — Manage My Rent
### by Rent N Stay

A production-grade property management & cash flow app built for the Rent N Stay team. Track rent collections, owner payments, utility bills, staff salaries, and run audit reconciliation — all in one place.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS (dark theme) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Charts | Recharts |
| Export | SheetJS (XLSX) |
| Routing | React Router v6 |
| Hosting | Vercel |

---

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/mmr-app.git
cd mmr-app
npm install
```

### 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `mmr-app`, choose a strong DB password, pick a region close to India (Mumbai/Singapore)
3. Once created, go to **Settings → API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_ANON_KEY`
4. Go to **SQL Editor** → New Query → paste the entire contents of `supabase_schema.sql` → Run

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Create First Super Admin

After running the SQL schema:

1. Go to Supabase → **Authentication → Users → Add User**
2. Enter email + password
3. Go to **Table Editor → profiles** → find the new user → set `role = super_admin`, `is_active = true`
4. Log in at `localhost:5173`

---

## Supabase Email Auth Setup (disable email confirmation for internal tool)

In Supabase → **Authentication → Settings**:
- **Enable Email Confirmations** → OFF (for internal tool, team members don't need to confirm)
- **Site URL** → `https://your-vercel-domain.vercel.app`
- **Redirect URLs** → add `https://your-vercel-domain.vercel.app/**`

---

## Deploy to Vercel

### Option A: GitHub → Vercel (recommended, auto-deploy on push)

1. Push code to GitHub:
```bash
git init
git add .
git commit -m "Initial MMR commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mmr-app.git
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Select `mmr-app` repo
4. Framework preset: **Vite** (auto-detected)
5. Add Environment Variables:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
6. Click **Deploy**

### Option B: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## Custom Domain (e.g. app.rentnstay.in)

1. In Vercel → your project → **Settings → Domains**
2. Add your domain: `mmr.rentnstay.in` or `app.rentnstay.in`
3. Vercel will show you DNS records to add
4. In your domain registrar (GoDaddy / Namecheap / Cloudflare etc.):
   - Add a **CNAME** record: `mmr` → `cname.vercel-dns.com`
   - Or an **A record** for root domain: `76.76.21.21`
5. Wait 10–30 mins for DNS propagation
6. SSL is auto-provisioned by Vercel (free)

---

## Role Matrix

| Feature | Super Admin | Admin | Team |
|---|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ |
| Buildings & Flats | ✅ | ✅ | ✅ |
| Owners | ✅ | ✅ | ✅ |
| Tenants | ✅ | ✅ | ✅ |
| Payments (Rent) | ✅ | ✅ | ✅ |
| Owner Payments | ✅ | ✅ | ✅ |
| Expenses | ✅ | ✅ | ✅ |
| Staff & Salaries | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ |
| **Audit** | ✅ | ❌ | ❌ |
| **Settings / Users** | ✅ | View only | ❌ |

---

## Project Structure

```
mmr-app/
├── src/
│   ├── components/
│   │   ├── layout/        # Sidebar, Layout
│   │   └── ui/            # Modal, Badge, StatCard, Spinner...
│   ├── contexts/
│   │   └── AuthContext.jsx
│   ├── lib/
│   │   └── supabase.js
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Buildings.jsx
│   │   ├── Owners.jsx
│   │   ├── Tenants.jsx
│   │   ├── Payments.jsx
│   │   ├── OwnerPayments.jsx
│   │   ├── Expenses.jsx
│   │   ├── Staff.jsx
│   │   ├── Reports.jsx
│   │   ├── Audit.jsx
│   │   └── Settings.jsx
│   ├── utils/
│   │   └── helpers.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── supabase_schema.sql    # Run this first in Supabase SQL Editor
├── vercel.json
├── vite.config.js
├── tailwind.config.js
└── .env.example
```

---

## Key Business Logic

- **Cash In**: Rent collections + utility charges from sub-lessees + security deposits
- **Cash Out**: Owner rent payments + utility bills (electricity/water) + staff salaries + general expenses
- **Net Flow** = Cash In − Cash Out (shown on Dashboard)
- **Security Deposit**: Per-tenant, tracked separately (not counted as revenue)
- **Audit**: Upload bank statement CSV/Excel → auto-parse → cross-check with internal records → flag anomalies

---

## Updating the App

```bash
git add .
git commit -m "Your change description"
git push origin main
```

Vercel auto-deploys in ~30 seconds. Zero downtime.

---

## Support & Notes

- Database backups: Supabase runs daily automated backups on paid plans. Enable **Point-in-time recovery** for production
- Row Level Security (RLS) is enabled — all data access is role-restricted at the database level
- All exports are client-side — no server needed for Excel generation
- App is a pure SPA — `vercel.json` handles all route rewrites

---

*Built for Rent N Stay — MMR v1.0*
