package scala

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Brxck2203/LenguajesProject1/go_service/internal/domain"
)

func TestAnalyzePartialSendsFullSnapshotAndRevision(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/analyze/partial" {
			t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		var payload struct {
			MatchID  string         `json:"matchId"`
			GameID   string         `json:"gameId"`
			Events   []domain.Event `json:"events"`
			Revision int            `json:"revision"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if payload.MatchID != "m1" || payload.GameID != domain.GameMemory || len(payload.Events) != 2 || payload.Revision != 2 {
			t.Errorf("unexpected payload: %+v", payload)
		}
		writer.Header().Set("Content-Type", "application/json")
		io.WriteString(writer, `{}`)
	}))
	defer server.Close()
	client, err := NewClient(server.URL+"/analyze", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	batch := domain.AnalysisRequest{
		MatchID: "m1", GameID: domain.GameMemory,
		Events: []domain.Event{{EventID: "start"}, {EventID: "flip"}},
	}
	if err := client.AnalyzePartial(context.Background(), batch, 2); err != nil {
		t.Fatalf("AnalyzePartial: %v", err)
	}
}

func TestAnalyzePartialIgnoresOnlyStaleOrFinalizedConflicts(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		body    string
		wantErr bool
	}{
		{name: "stale", body: `{"stale":true}`},
		{name: "finalized", body: `{"finalized":true}`},
		{name: "unknown conflict", body: `{"error":"conflict"}`, wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.WriteHeader(http.StatusConflict)
				io.WriteString(writer, testCase.body)
			}))
			defer server.Close()
			client, err := NewClient(server.URL+"/analyze", time.Second)
			if err != nil {
				t.Fatal(err)
			}
			err = client.AnalyzePartial(context.Background(), domain.AnalysisRequest{Events: []domain.Event{{}}}, 1)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("AnalyzePartial error = %v, wantErr %v", err, testCase.wantErr)
			}
		})
	}
}

func TestAnalyzePartialRequiresRevisionToMatchEventCount(t *testing.T) {
	client, err := NewClient("http://localhost/analyze", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	err = client.AnalyzePartial(context.Background(), domain.AnalysisRequest{Events: []domain.Event{{}}}, 2)
	var failure *Error
	if !errors.As(err, &failure) || failure.Retryable {
		t.Fatalf("error = %v, want permanent revision error", err)
	}
}
