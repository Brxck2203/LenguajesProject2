package scala

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/Brxck2203/LenguajesProject1/go_service/internal/domain"
)

type partialRequest struct {
	domain.AnalysisRequest
	Revision int `json:"revision"`
}

type partialConflict struct {
	Stale     bool `json:"stale"`
	Finalized bool `json:"finalized"`
}

func (client *Client) AnalyzePartial(ctx context.Context, batch domain.AnalysisRequest, revision int) error {
	if revision < 1 || revision != len(batch.Events) {
		return &Error{Message: "partial analysis revision must equal the positive event count"}
	}
	endpoint, err := url.Parse(client.endpoint)
	if err != nil {
		return &Error{Message: "parse Scala partial analysis URL: " + err.Error()}
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/partial"
	body, err := json.Marshal(partialRequest{AnalysisRequest: batch, Revision: revision})
	if err != nil {
		return &Error{Message: "encode partial analysis request: " + err.Error()}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return &Error{Message: "create partial analysis request: " + err.Error()}
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return &Error{Message: "send partial analysis request: " + err.Error(), Retryable: true}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK {
		mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if err != nil || !strings.EqualFold(mediaType, "application/json") {
			return &Error{Message: "Scala partial response Content-Type must be application/json"}
		}
		return nil
	}
	if response.StatusCode == http.StatusConflict {
		data, err := io.ReadAll(io.LimitReader(response.Body, 1024))
		if err != nil {
			return &Error{Message: "read Scala partial conflict response: " + err.Error(), Retryable: true}
		}
		var conflict partialConflict
		if len(data) > 1024 || json.Unmarshal(data, &conflict) != nil {
			return &Error{Message: "Scala returned an unrecognized partial conflict"}
		}
		if conflict.Stale || conflict.Finalized {
			return nil
		}
		return &Error{Message: "Scala returned an unrecognized partial conflict"}
	}
	return &Error{
		Message:   fmt.Sprintf("Scala partial analysis returned HTTP %d", response.StatusCode),
		Retryable: response.StatusCode == http.StatusRequestTimeout || response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500,
	}
}
