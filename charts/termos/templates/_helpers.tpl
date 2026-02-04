{{/*
Expand the name of the chart.
*/}}
{{- define "termos.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "termos.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "termos.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "termos.labels" -}}
helm.sh/chart: {{ include "termos.chart" . }}
{{ include "termos.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "termos.selectorLabels" -}}
app.kubernetes.io/name: {{ include "termos.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "termos.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "termos.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Common environment variables for workers
*/}}
{{- define "termos.workerEnv" -}}
- name: SLACK_BOT_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "termos.fullname" . }}-secrets
      key: slack-bot-token
{{- end }}

{{/*
Common volume mounts for workers
*/}}
{{- define "termos.workerVolumeMounts" -}}
- name: workspace
  mountPath: /workspace
{{- end }}

{{/*
Common volumes for workers
*/}}
{{- define "termos.workerVolumes" -}}
- name: workspace
  emptyDir:
    sizeLimit: {{ .Values.worker.workspace.sizeLimit }}
{{- end }}