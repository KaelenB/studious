import type { FastifyReply, FastifyRequest } from 'fastify';
import { accountParams, historyQuery, statementParams, statementQuery } from '@studious/api';
import type { createStatementService } from '../services/statements.js';
import { StatementError } from '../services/extractors.js';
import { statementView } from '../views/statements.js';

export function createStatementController(service: ReturnType<typeof createStatementService>) {
  function validateType(request: FastifyRequest, filename: string) {
    const expected = /\.xlsx$/i.test(filename)
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';
    if (request.headers['content-type']?.split(';')[0] !== expected) {
      throw new StatementError('File extension and Content-Type must match.');
    }
  }
  function upload(request: FastifyRequest) {
    if (!(request.body instanceof Uint8Array))
      throw new StatementError('Send a PDF or XLSX with its matching Content-Type.');
    return request.body;
  }
  return {
    async extractInvestments(request: FastifyRequest) {
      const { householdId, accountId, statementId } = statementParams.parse(request.params);
      return statementView(await service.extractInvestments(householdId, accountId, statementId));
    },
    async preview(request: FastifyRequest) {
      const { householdId, accountId } = accountParams.parse(request.params);
      const { filename, statementDate } = statementQuery.parse(request.query);
      validateType(request, filename);
      return service.preview(householdId, accountId, upload(request), filename, statementDate);
    },
    async import(request: FastifyRequest, reply: FastifyReply) {
      const { householdId, accountId } = accountParams.parse(request.params);
      const { filename, statementDate } = statementQuery.parse(request.query);
      validateType(request, filename);
      return reply
        .code(201)
        .send(
          statementView(
            await service.import(householdId, accountId, filename, upload(request), statementDate),
          ),
        );
    },
    async list(request: FastifyRequest) {
      const { householdId, accountId } = accountParams.parse(request.params);
      const { limit, offset } = historyQuery.parse(request.query);
      return (await service.list(householdId, accountId, limit, offset)).map(statementView);
    },
    async download(request: FastifyRequest, reply: FastifyReply) {
      const { householdId, accountId, statementId } = statementParams.parse(request.params);
      const row = await service.download(householdId, accountId, statementId);
      const isXlsx = row.provider === 'QUESTRADE';
      if (request.url.split('?')[0]!.endsWith('/pdf') && isXlsx)
        throw new StatementError('This archive is a spreadsheet; use its file download.');
      return reply
        .type(
          isXlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf',
        )
        .header(
          'Content-Disposition',
          `attachment; filename="statement.${isXlsx ? 'xlsx' : 'pdf'}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        )
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(row.pdf);
    },
  };
}
