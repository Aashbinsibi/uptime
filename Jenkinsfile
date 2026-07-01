pipeline {
    agent any

    tools {
        // Reference the NodeJS installation configured in Jenkins Global Tool Configuration
        // Adjust the name ('node-20') to match your Jenkins configuration
        nodejs 'node-20'
    }

    options {
        // Discard old builds to save disk space
        buildDiscarder(logRotator(numToKeepStr: '10'))
        // Prevent running multiple builds of this job concurrently
        disableConcurrentBuilds()
        // Fail the build if it takes longer than 30 minutes
        timeout(time: 30, unit: 'MINUTES')
        // Prepend timestamps to console output logs
        timestamps()
    }

    environment {
        // Define global environment variables
        APP_NAME    = 'uptime-monitor'
        DEPLOY_ENV  = 'production'
    }

    stages {
        stage('Prepare Workspace') {
            steps {
                echo 'Cleaning workspace and checking out source code...'
                cleanWs()
                checkout scm
            }
        }

        stage('Install Dependencies') {
            parallel {
                stage('Backend Dependencies') {
                    steps {
                        dir('backend') {
                            echo 'Installing backend dependencies...'
                            sh 'npm ci'
                        }
                    }
                }
                stage('Frontend Dependencies') {
                    steps {
                        dir('frontend') {
                            echo 'Installing frontend dependencies...'
                            sh 'npm ci'
                        }
                    }
                }
            }
        }

        stage('Verify & Test') {
            parallel {
                stage('Test Backend') {
                    steps {
                        dir('backend') {
                            echo 'Testing backend...'
                            sh 'npm run test'
                        }
                    }
                }
            }
        }

        stage('Build') {
            parallel {
                stage('Build Backend') {
                    steps {
                        dir('backend') {
                            echo 'Building backend production bundle...'
                            sh 'npm run build'
                        }
                    }
                }
                stage('Build Frontend') {
                    steps {
                        dir('frontend') {
                            echo 'Building frontend production bundle...'
                            sh 'npm run build'
                        }
                    }
                }
            }
        }

        stage('Deploy') {
            // Only deploy when building the main branch
            when {
                branch 'main'
            }
            steps {
                echo "Deploying ${APP_NAME} to ${DEPLOY_ENV} environment..."
                // Add your custom deployment command here
                // e.g., sh './scripts/deploy.sh'
            }
        }
    }

    post {
        always {
            echo 'Archiving build artifacts...'
            // Archive the dist folders from both frontend and backend
            archiveArtifacts artifacts: 'backend/dist/**, frontend/dist/**', allowEmptyArchive: true
            
            echo 'Cleaning workspace post-run...'
            cleanWs()
        }
        success {
            echo 'Pipeline completed successfully!'
        }
        failure {
            echo 'Pipeline failed. Sending alert...'
            // Example email or Slack notification:
            // slackSend channel: '#ci-cd-alerts', color: '#FF0000', message: "BUILD FAILED: Job '${env.JOB_NAME}' (${env.BUILD_NUMBER}) - ${env.BUILD_URL}"
        }
    }
}
