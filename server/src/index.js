import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import accountsRouter from './routes/accounts.js';
import transactionsRouter from './routes/transactions.js';
import summaryRouter from './routes/summary.js';
import budgetsRouter from './routes/budgets.js';
import categoriesRouter from './routes/categories.js';
import importsRouter from './routes/imports.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/categories', categoriesRouter);
// Larger JSON body limit scoped to this router only: a ~20k-row commit
// payload (~2-4MB) would exceed express.json()'s default 100KB cap and get
// rejected with an HTML 413 before reaching the route. The global
// express.json() above stays at its default for every other router.
app.use('/api/imports', express.json({ limit: '25mb' }), importsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Budget server listening on http://localhost:${PORT}`);
});
