# Caomisa

Loja da Caomisa com catálogo sincronizado da Yampi, páginas de produto, admin, avaliações, coleções e checkout.

## Rodar Local

```bash
npm run dev
```

Abra `http://localhost:4173`.

## Produção Na Vercel

O projeto está pronto para subir pelo GitHub/Vercel. O arquivo `vercel.json` roteia:

- `/api/*` para a função serverless `api/index.js`;
- `/produto/*` para `produto.html`;
- `/produtos`, `/admin`, `/ajuda` e `/politicas` para seus HTMLs.

## Variáveis Obrigatórias

Crie estas variáveis no painel da Vercel, em Project Settings > Environment Variables. Nunca coloque esses valores no GitHub.

```text
YAMPI_ALIAS
YAMPI_USER_TOKEN
YAMPI_USER_SECRET_KEY
PUBLIC_SITE_URL=https://caomisa.shop
ADMIN_USER
ADMIN_PASS
ADMIN_SESSION_SECRET
KV_REST_API_URL
KV_REST_API_TOKEN
DATA_KV_PREFIX=caomisa
```

`YAMPI_CHECKOUT_BASE` e `YAMPI_WEBHOOK_SECRET` são opcionais.

Para gerar `ADMIN_SESSION_SECRET`:

```bash
npm run secret:admin
```

## Storage Do Admin

Localmente, o admin usa os arquivos `data/*.json`. Na Vercel, ele usa Vercel KV/Upstash pelas variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`.

Depois de criar o KV e colocar as variáveis também no `.env` local, envie os dados locais atuais para o KV uma vez:

```bash
npm run seed:kv
```

Isso preserva conteúdo editado no admin, avaliações, coleções, cache de produtos e configuração do webhook sem commitar JSON sensível/operacional.

## Imagens WebP

As imagens do projeto versionadas aqui ficam em WebP. Os uploads feitos pelo admin passam por conversão no navegador antes de salvar, então JPG/PNG/JPEG enviados por formulário viram `data:image/webp`.

## Webhook Da Yampi

Depois do deploy e das variáveis configuradas:

1. Acesse `/admin`.
2. Entre com `ADMIN_USER` e `ADMIN_PASS`.
3. Clique em `Ativar webhook`.

A Yampi chamará `https://caomisa.shop/api/yampi/webhook` e o catálogo será sincronizado automaticamente.

## Segurança

- `.env` fica fora do GitHub.
- `data/*.json` fica fora do GitHub.
- O login do admin agora passa por `/api/admin/login`.
- Rotas de escrita/moderação/admin exigem token Bearer assinado por `ADMIN_SESSION_SECRET`.
- Checkout e envio público de avaliações continuam abertos para clientes.
