This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Types PMS (OpenAPI)

Le front ne parle qu'au **BFF** (`NEXT_PUBLIC_API_URL`), jamais directement au PMS, mais partage
les **types de contrat** générés depuis l'OpenAPI de Stay-api dans `src/types/generated/pms.ts`
(config : `openapi-ts.config.ts`, snapshot : `openapi/stay-api.json`). Ces fichiers sont
**générés, jamais édités à la main** (`yarn gen:types`).

Pour rafraîchir le snapshot après un changement de contrat PMS (Swagger exposé uniquement en
Development, `http://localhost:5231`) :

```bash
curl http://localhost:5231/swagger/v1/swagger.json -o openapi/stay-api.json
yarn gen:types
```

Le client HTTP `src/lib/api-client.ts` cible le BFF et envoie le **cookie de session opaque**
(`credentials: "include"`) : aucune garde JWT au navigateur (le BFF est gardien des jetons).
