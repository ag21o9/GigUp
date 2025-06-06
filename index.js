import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';


import {PrismaClient} from './generated/prisma/client.js'; // 
const prisma = new PrismaClient();

import { flRouter } from './freelancer/freelancer.js';
import { clientRouter } from './client/client.js';

const PORT = process.env.PORT || 3000;
const app = express();


dotenv.config();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1/freelancer', flRouter);
app.use('/api/v1/client', clientRouter)

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
