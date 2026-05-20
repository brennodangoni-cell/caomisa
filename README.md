# Caomisa

Landing page estatica da Caomisa para vender a camisa pet verde e amarela, com foco em conversao mobile.

## Como rodar localmente

```bash
npm run dev
```

Abrir no navegador:

```text
http://localhost:4173
```

## Estrutura do projeto

- `index.html`: pagina principal da oferta.
- `styles.css`: visual geral, responsividade e refinamento mobile.
- `script.js`: troca de imagens, tamanhos, quantidade, CTA e modal de checkout.
- `politicas.html`: pagina base de politicas da loja.
- `server.js`: servidor local simples para desenvolvimento.
- `assets/logo-caomisa-header.png`: logo atual da marca.

## O que ja fizemos

- Criamos a landing da Caomisa com foco em um produto so.
- Ajustamos o visual para ficar mais enxuto no mobile.
- Aplicamos fonte estilo iOS/San Francisco no site todo.
- Trocamos a identidade para `Caomisa` e configuramos `caomisa.shop` nos metadados.
- Colocamos a logo nova no header e removemos o texto ao lado.
- Reduzimos a logo e limpamos o topo, incluindo a remocao da barra `Envio nacional`.
- Removemos a barra fixa inferior de compra.
- Mantivemos galeria principal com thumbs e foto do produto no topo.
- Mantivemos seletor de tamanhos com `PP`, `P`, `M`, `G` e `GG`.
- Deixamos o tamanho `P` desabilitado, sem texto extra de esgotado.
- Removemos a calculadora de tamanho.
- Refizemos a secao de `Tabela de tamanhos e medidas` em formato de tabela, pensada para mobile sem arrastar.
- Padronizamos a linha do tamanho `M` para ficar igual as outras.
- Mantivemos espaco para VSL logo abaixo da oferta.
- Mantivemos placeholder para plugin de avaliacoes.
- Removemos blocos que voce pediu para limpar, como badges, kit 2 camisas, camisa + bandana, garantia/card de compra segura e textos mais longos de troca.
- Ajustamos o fluxo textual para checkout pela Yampi.
- Suavizamos/removemos o hover estranho dos botoes no mobile.

## Estado atual da pagina

Hoje a pagina tem:

- header limpo com logo;
- galeria de fotos;
- titulo, preco e CTA;
- seletor de tamanho;
- seletor de quantidade;
- observacao do checkout;
- bloco de video/VSL;
- tabela de tamanhos e medidas;
- area reservada para avaliacoes;
- FAQ;
- pagina de politicas separada.

## O que ainda falta para publicar de verdade

1. Criar o produto real no checkout da Yampi.
2. Definir o link final do checkout.
3. Confirmar preco final, preco de comparacao, frete e prazo real.
4. Trocar as imagens de referencia por fotos finais do produto.
5. Adicionar o video final da VSL, se for usar.
6. Instalar o plugin de avaliacoes.
7. Revisar e completar `politicas.html` com dados reais da operacao.
8. Subir o projeto em uma hospedagem e apontar o dominio `caomisa.shop`.
9. Inserir pixels e analytics, se for rodar trafego.

## Dados que voce ainda precisa me passar

- link final do checkout da Yampi;
- preco final e preco promocional;
- frete e prazo de entrega reais;
- link ou arquivo do video da VSL;
- plugin de avaliacoes escolhido;
- pixel da Meta, GA4 e TikTok Pixel, se quiser rastreamento;
- acesso da hospedagem ou plataforma onde vamos publicar;
- acesso do dominio ou painel DNS, se voce quiser ajuda no apontamento.

## Onde configurar cada coisa

### Checkout, WhatsApp, VSL e pixels

Arquivo: `script.js`

Procure pelo objeto `STORE_CONFIG`.

```js
const STORE_CONFIG = {
  checkoutBaseUrl: "https://seu-checkout.com/produto",
  whatsappNumber: "5511999999999",
  vslEmbedUrl: "https://www.youtube.com/embed/SEU_VIDEO",
  pixelIds: {
    meta: "",
    googleAnalytics: "",
    tiktok: ""
  }
};
```

### Plugin de avaliacoes

Arquivo: `index.html`

Procure por:

```html
<div id="reviews-plugin"></div>
```

Esse e o ponto reservado para colar o widget do app/plugin de avaliacoes.

### Logo

Arquivo atual da logo:

`assets/logo-caomisa-header.png`

Se voce mandar outra versao, e so substituir esse arquivo ou ajustar o `src` no `index.html` e `politicas.html`.

## Observacoes importantes

- As imagens atuais do produto ainda sao referencias externas. O ideal e trocar por imagens proprias ou do fornecedor antes de anunciar.
- A pagina esta pronta como landing estatica. O checkout real depende do link final da Yampi.
- `politicas.html` ainda e uma base e precisa receber os dados reais da loja.

## Proximo passo recomendado

O proximo passo mais util agora e criar o produto na Yampi e me passar:

1. nome final do produto;
2. preco;
3. imagens finais;
4. link do checkout;
5. prazo/frete.

Com isso, a gente fecha a integracao e deixa a pagina pronta para publicar.
