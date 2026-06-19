import express from 'express';
import cors from 'cors';
import accountsRouter from './routes/accounts.js';
import transactionsRouter from './routes/transactions.js';
import summaryRouter from './routes/summary.js';
import budgetsRouter from './routes/budgets.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/budgets', budgetsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Budget server listening on http://localhost:${PORT}`);
});
