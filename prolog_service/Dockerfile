FROM swipl:10.0.2

WORKDIR /app
COPY tictactoe.pl api.pl server.pl ./
COPY tests ./tests

# La imagen no se construye si alguna prueba de reglas o de la IA falla.
ARG SKIP_TESTS=false
RUN if [ "$SKIP_TESTS" != "true" ]; then swipl -g run_tests -t halt tests/test_tictactoe.pl; fi

ENV PORT=8082
EXPOSE 8082

HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD swipl -g "use_module(library(http/http_open)), http_open('http://127.0.0.1:8082/health', S, []), close(S)" -t halt

CMD ["swipl", "/app/server.pl"]
