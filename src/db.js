// Cliente Prisma único, reaproveitado em toda a aplicação.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
