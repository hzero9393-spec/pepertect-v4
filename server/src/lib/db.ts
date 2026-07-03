import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { config } from '../config.js'

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 })
const adapter = new PrismaPg(pool)

export const db = new PrismaClient({ adapter, log: ['error'] })