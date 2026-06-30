import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: "postgresql://postgres.atxcddflbwbskzyaahmy:Ashish@603281337259@aws-1-ap-south-1.pooler.supabase.com:5432/postgres",
  },
})
