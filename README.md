# Girassol - Corrigir NFs

Serviço Node.js hospedado no Render que monitora e corrige automaticamente Notas Fiscais com erro no Bling ERP da empresa **Magazine Girassol**.

---

## O que o serviço faz

A cada **5 minutos** (das 06h às 23h), o serviço busca NFs com erro nas últimas 72h e tenta corrigir automaticamente os seguintes problemas:

### 1. Cidade inválida (erro `cMun`)
O cliente cadastrou uma cidade que não existe no IBGE (ex: "Sabiaguaba", "Arraial da Ajuda", "Parati"). O serviço:
- Busca o CEP da NF no **ViaCEP**
- Obtém a cidade correta
- Atualiza o endereço na própria NF
- Salva e reenvia a NF para a SEFAZ

### 2. IE do destinatário não informada (erro 232 — PJ)
Quando o cliente é Pessoa Jurídica (CNPJ) e a Inscrição Estadual não está preenchida. O serviço:
- Consulta o CNPJ no **SintegraWS**
- Se encontrar a IE → preenche na NF e no cadastro do cliente, marca como "Contribuinte ICMS"
- Se não encontrar → loga para intervenção manual
- Salva e reenvia a NF

### 3. Endereço muito curto (menos de 2 caracteres)
Quando o cliente preencheu o campo endereço com apenas 1 caractere (ex: "6"). O serviço:
- Adiciona o prefixo `"Endereço "` antes do valor (ex: "Endereço 6")
- Salva e reenvia a NF

---

## Fluxo técnico de correção

```
1. GET /nfe?situacao={1,4,5} → lista NFs com erro das últimas 72h
2. Para cada NF:
   a. GET /nfe/{id} → busca detalhe completo
   b. Se tem XML gerado → já foi autorizada, ignora
   c. Se situacao=2 → já autorizada, ignora
   d. Verifica e corrige: endereço curto, cidade, IE
3. PUT /nfe/{id} → salva NF com correções + intermediador fixo
4. POST /nfe/{id}/enviar → reenvia para a SEFAZ
```

> **Importante:** O PUT da NF sempre inclui o campo `intermediador` (CNPJ: `03.007.331/0001-41`, nome: `MAGAZINEGIRASSOL`) pois ele não retorna no GET mas é obrigatório para NFs do Mercado Livre. As parcelas são removidas do PUT para evitar erros de divergência de valor.

---

## Variáveis de ambiente (Render)

| Variável | Descrição | Exemplo |
|---|---|---|
| `BLING_CLIENT_ID` | Client ID do app no Bling | `abc123` |
| `BLING_CLIENT_SECRET` | Client Secret do app no Bling | `xyz456` |
| `BLING_REDIRECT_URI` | URL de callback do OAuth | `http://localhost:3000/callback` |
| `TOKEN_FILE` | Caminho do arquivo de tokens | `/data/tokens.json` |
| `TZ` | Timezone | `America/Sao_Paulo` |
| `SINTEGRA_TOKEN` | Token da API SintegraWS | `13FBF84C-...` |
| `INTERMEDIADOR_CNPJ` | CNPJ do intermediador ML | `03007331000141` |
| `INTERMEDIADOR_NOME` | Nome do intermediador ML | `MAGAZINEGIRASSOL` |

> O Render deve ter um **Disk** montado em `/data` para persistir o arquivo `tokens.json`.

---

## Endpoints HTTP

| Método | URL | Descrição |
|---|---|---|
| `GET` | `/` ou `/health` | Status do serviço |
| `POST` | `/setup` | Gera tokens a partir de um `auth_code` do Bling |
| `POST` | `/run` | Força execução imediata da rotina de correção |
| `GET` | `/debug/token` | Retorna o access token atual |
| `GET` | `/debug/nf/:id` | Retorna o detalhe de uma NF pelo ID interno |
| `POST` | `/setup-token` | Salva tokens diretamente (body: `{access_token, refresh_token}`) |

---

## Setup inicial (primeira vez)

1. Criar aplicativo no Bling em **Configurações → Integrações → API → Novo aplicativo**
   - URL de redirecionamento: `http://localhost:3000/callback`
   - Escopos: Nota Fiscal, Contatos
2. Configurar as variáveis de ambiente no Render
3. Adicionar Disk em `/data` (1 GB)
4. Acessar o **Link de convite** do app no Bling e autorizar
5. Copiar o `code` da URL e rodar:
```powershell
Invoke-RestMethod -Uri "https://SEU-SERVICO.onrender.com/setup" -Method POST -ContentType "application/json" -Body '{"auth_code":"COLE_O_CODE_AQUI"}'
```

---

## APIs externas utilizadas

| API | Uso | Custo |
|---|---|---|
| [ViaCEP](https://viacep.com.br) | Buscar cidade pelo CEP | Gratuito |
| [SintegraWS](https://sintegraws.com.br) | Buscar IE pelo CNPJ | Pago (créditos pré-pagos) |
| [Bling API v3](https://developer.bling.com.br) | Gerenciar NFs e contatos | Incluído no plano Bling |

---

## Situações de NF no Bling

| Código | Situação |
|---|---|
| `1` | Pendente |
| `2` | Autorizada |
| `4` | Rejeitada |
| `5` | Erro no envio |

---

## Intervenção manual necessária

O serviço **não consegue corrigir automaticamente**:
- IE de empresas não cadastradas no SINTEGRA (retorno código 1)
- Erros não mapeados no código

Nesses casos, o log exibe: `IE não encontrada — intervenção manual`

---

## Arquivos do projeto

| Arquivo | Descrição |
|---|---|
| `index.js` | Servidor HTTP, cron e lógica principal |
| `blingApi.js` | Funções de comunicação com a API do Bling, ViaCEP e SintegraWS |
| `tokenManager.js` | Gerenciamento de tokens OAuth2 do Bling |
| `package.json` | Dependências do projeto |
